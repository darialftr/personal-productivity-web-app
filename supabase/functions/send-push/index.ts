import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:hello@itera.app";
const cronSecret = Deno.env.get("PUSH_CRON_SECRET");

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

type NotificationPreferenceRow = {
  user_id: string;
  timezone: string | null;
};

type RhythmNotification = {
  user_id: string;
  title: string;
  body: string;
  target_url: string;
  tag: string;
  notification_type: string;
  dedupe_key: string;
  scheduled_for: string;
  status: "pending";
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await request.json().catch(() => ({}));
    const authorization = request.headers.get("Authorization");
    const isCron = Boolean(
      cronSecret && request.headers.get("x-cron-secret") === cronSecret
    );

    if (payload.test) {
      const user = await authenticatedUser(authorization);
      if (!user) return json({ error: "Unauthorized" }, 401);

      const subscriptions = await subscriptionsForUser(user.id);
      const result = await sendToSubscriptions(subscriptions, {
        title: payload.title || "Itera",
        body: payload.body || "Notificările funcționează.",
        url: payload.url || "./index.html#/",
        tag: "itera-test"
      });
      return json({ ok: true, ...result });
    }

    if (!isCron) return json({ error: "Unauthorized" }, 401);

    const rhythmicQueued = await enqueueServerRhythmReminders();

    const { data: queue, error: queueError } = await admin
      .from("notification_queue")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for")
      .limit(100);

    if (queueError) throw queueError;

    let sent = 0;
    let failed = 0;

    for (const notification of queue || []) {
      const delayMs = Date.now() - new Date(notification.scheduled_for).getTime();
      if (notification.notification_type === "task-start" && delayMs > 2 * 60 * 1000) {
        await admin.from("notification_queue").update({
          status: "cancelled",
          last_error: "Reminder expired before delivery.",
          updated_at: new Date().toISOString()
        }).eq("id", notification.id);
        continue;
      }

      await admin.from("notification_queue")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", notification.id);

      const subscriptions = await subscriptionsForUser(notification.user_id);
      const result = await sendToSubscriptions(subscriptions, {
        title: notification.title,
        body: notification.body,
        url: notification.target_url,
        tag: notification.tag,
        notificationType: notification.notification_type,
        notificationId: notification.id
      });

      const status = result.sent > 0 ? "sent" : "failed";
      await admin.from("notification_queue").update({
        status,
        sent_at: status === "sent" ? new Date().toISOString() : null,
        attempt_count: Number(notification.attempt_count || 0) + 1,
        last_error: status === "failed" ? "No active subscription accepted the push." : null,
        updated_at: new Date().toISOString()
      }).eq("id", notification.id);

      sent += result.sent;
      failed += result.failed;
    }

    return json({ ok: true, rhythmicQueued, processed: queue?.length || 0, sent, failed });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

async function authenticatedUser(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

async function subscriptionsForUser(userId: string): Promise<PushSubscriptionRow[]> {
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth_key")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (error) throw error;
  return data || [];
}

async function enqueueServerRhythmReminders() {
  try {
    const { data: subscriptions, error: subscriptionError } = await admin
      .from("push_subscriptions")
      .select("user_id")
      .eq("enabled", true);
    if (subscriptionError) throw subscriptionError;

    const userIds = [...new Set((subscriptions || []).map((row) => row.user_id).filter(Boolean))];
    if (!userIds.length) return 0;

    const preferenceResult = await admin
      .from("notification_preferences")
      .select("user_id,timezone")
      .in("user_id", userIds);
    const preferences = (preferenceResult.data || []) as NotificationPreferenceRow[];
    const timezoneByUser = new Map((preferences || []).map((row) => [row.user_id, row.timezone || "Europe/Bucharest"]));
    const now = new Date();
    const gracePeriodMs = 20 * 60 * 1000;
    const morningMessages = [
      "Bună dimineața. Azi nu trebuie să faci totul dintr-odată.",
      "Un început calm, apoi primul pas. Itera este cu tine.",
      "Ai o zi nouă în față. Alege ce contează și începem ușor."
    ];
    const rows: RhythmNotification[] = [];

    userIds.forEach((userId) => {
      const timezone = safeTimezone(timezoneByUser.get(userId));
      const todayParts = zonedParts(now, timezone);
      for (let offset = 0; offset < 7; offset += 1) {
        const calendarDate = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day + offset, 12));
        const dateKey = `${calendarDate.getUTCFullYear()}-${String(calendarDate.getUTCMonth() + 1).padStart(2, "0")}-${String(calendarDate.getUTCDate()).padStart(2, "0")}`;
        const weekend = [0, 6].includes(calendarDate.getUTCDay());
        const moments = [
          {
            time: weekend ? "09:00" : "07:15",
            title: "O zi bună începe blând",
            body: morningMessages[offset % morningMessages.length],
            type: "morning-rhythm",
            suffix: "morning"
          },
          {
            time: "22:15",
            title: "Închidem ziua încet",
            body: "Mai ai timp să pui telefonul jos și să te pregătești de somn.",
            type: "bedtime-rhythm",
            suffix: "bedtime-0"
          },
          {
            time: "22:45",
            title: "Hei, chiar este timpul de odihnă",
            body: "Mâine îți va fi mai ușor dacă te culci acum.",
            type: "bedtime-rhythm",
            suffix: "bedtime-1"
          },
          {
            time: "23:15",
            title: "Ultimul reminder de la Itera",
            body: "Gata pentru azi. Lasă restul pe mâine și mergi la somn.",
            type: "bedtime-rhythm",
            suffix: "bedtime-2"
          }
        ];

        moments.forEach((moment) => {
          const scheduledFor = zonedDateToUtc(dateKey, moment.time, timezone);
          if (scheduledFor.getTime() < now.getTime() - gracePeriodMs) return;
          rows.push({
            user_id: userId,
            title: moment.title,
            body: moment.body,
            target_url: "./index.html#/",
            tag: `${moment.suffix}-${dateKey}`,
            notification_type: moment.type,
            dedupe_key: `${moment.suffix}-${userId}-${dateKey}`,
            scheduled_for: scheduledFor.toISOString(),
            status: "pending"
          });
        });
      }
    });

    if (!rows.length) return 0;
    const { error } = await admin
      .from("notification_queue")
      .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (error) throw error;
    return rows.length;
  } catch (error) {
    console.error("Could not enqueue rhythm reminders", error);
    return 0;
  }
}

function safeTimezone(value: string | undefined) {
  const timezone = value || "Europe/Bucharest";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "Europe/Bucharest";
  }
}

function zonedParts(date: Date, timezone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function zonedDateToUtc(dateKey: string, time: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const observed = zonedParts(utcGuess, timezone);
  const observedAsUtc = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    observed.second
  );
  return new Date(utcGuess.getTime() - (observedAsUtc - utcGuess.getTime()));
}

async function sendToSubscriptions(
  subscriptions: PushSubscriptionRow[],
  payload: Record<string, unknown>
) {
  let sent = 0;
  let failed = 0;
  const ttl = payload.notificationType === "task-start" ? 120 : 3600;

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth_key
        }
      }, JSON.stringify(payload), { TTL: ttl });
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions")
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq("id", subscription.id);
      }
    }
  }));

  return { sent, failed };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
