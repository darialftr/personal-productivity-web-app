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
  source_id?: string;
  dedupe_key: string;
  scheduled_for: string;
  status: "pending";
};

type TaskPlanEntry = {
  date?: string;
  time?: string;
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
      if (notification.source_id && ["task-start", "task-reminder", "task-continuation", "task-nudge"].includes(notification.notification_type)) {
        const taskIsOpen = await isTaskStillOpen(notification.source_id, notification.user_id);
        if (!taskIsOpen) {
          await admin.from("notification_queue").update({
            status: "cancelled",
            last_error: "Task already completed or removed.",
            updated_at: new Date().toISOString()
          }).eq("id", notification.id);
          continue;
        }
      }

      if (notification.notification_type === "task-nudge" && notification.source_id &&
        await userOpenedIteraAfterTaskStart(notification.source_id, notification.user_id)) {
        await admin.from("notification_queue").update({
          status: "cancelled",
          last_error: "User opened Itera after the task start reminder.",
          updated_at: new Date().toISOString()
        }).eq("id", notification.id);
        continue;
      }

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
        notificationId: notification.id,
        renotify: notification.notification_type === "task-nudge"
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
    const planByUser = new Map<string, Record<string, TaskPlanEntry>>();
    await Promise.all(userIds.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      const storedPlan = data?.user?.user_metadata?.itera_task_plan;
      planByUser.set(userId, storedPlan && typeof storedPlan === "object" ? storedPlan : {});
    }));
    const now = new Date();
    const gracePeriodMs = 20 * 60 * 1000;
    const morningMessages = [
      "Bună dimineața. Planul zilei te așteaptă. Alegem primul pas și începem.",
      "Nu așteptăm să apară cheful. Alegem primul task și îi dăm drumul.",
      "Ziua nu se organizează singură. Pune lista în ordine și începe primul pas."
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

    rows.push(...await buildTaskNudges(userIds, timezoneByUser, planByUser, now, gracePeriodMs));

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

async function buildTaskNudges(
  userIds: string[],
  timezoneByUser: Map<string, string>,
  planByUser: Map<string, Record<string, TaskPlanEntry>>,
  now: Date,
  gracePeriodMs: number
): Promise<RhythmNotification[]> {
  const { data: taskRows, error } = await admin
    .from("tasks")
    .select("id,user_id,title,deadline_date,deadline_time,task_type,notes,priority,created_at")
    .in("user_id", userIds)
    .eq("completed", false)
    .not("deadline_date", "is", null)
    .limit(500);
  if (error) throw error;

  const messages = [
    {
      title: "E momentul să începi.",
      body: (taskTitle: string) => `Deschide „${taskTitle}” și ocupă-te doar de primele 10 minute.`
    },
    {
      title: "Nu mai mutăm momentul.",
      body: (taskTitle: string) => `„${taskTitle}” este încă în plan. Începe acum, apoi Itera îți păstrează pauza.`
    },
    {
      title: "Taskul încă te așteaptă.",
      body: (taskTitle: string) => `Hai să închidem „${taskTitle}”. După aceea, restul zilei va fi mai ușor.`
    }
  ];
  const fixedPersonalTypes = new Set(["personal", "selfcare", "home", "health", "errand"]);
  const rows: RhythmNotification[] = [];

  for (const userId of userIds) {
    const timezone = safeTimezone(timezoneByUser.get(userId));
    const local = zonedParts(now, timezone);
    const todayKey = `${local.year}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;
    const storedPlan = planByUser.get(userId) || {};
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const candidates = (taskRows || []).filter((task) => {
      if (task.user_id !== userId) return false;
      const notes = String(task.notes || "");
      if (fixedPersonalTypes.has(task.task_type) && !notes.includes("[itera:task-only]")) return false;
      const entry = storedPlan[String(task.id)];
      return String(entry?.date || task.deadline_date) <= todayKey;
    }).sort((first, second) => {
      const firstPlan = storedPlan[String(first.id)];
      const secondPlan = storedPlan[String(second.id)];
      return String(firstPlan?.date || first.deadline_date).localeCompare(String(secondPlan?.date || second.deadline_date)) ||
        String(firstPlan?.time || "99:99").localeCompare(String(secondPlan?.time || "99:99")) ||
        (priorityOrder[first.priority] ?? 1) - (priorityOrder[second.priority] ?? 1) ||
        String(first.created_at || "").localeCompare(String(second.created_at || ""));
    });

    const planned = candidates.filter((task) => {
      const entry = storedPlan[String(task.id)];
      return entry?.date === todayKey && Boolean(entry.time);
    });
    const plannedIds = new Set(planned.map((task) => String(task.id)));
    const fallback = candidates.filter((task) => !plannedIds.has(String(task.id)));

    planned.forEach((task) => {
      const entry = storedPlan[String(task.id)];
      const start = zonedDateToUtc(todayKey, String(entry.time).slice(0, 5), timezone);
      addTaskMoment(task, new Date(start.getTime() - 60000), -1, todayKey, String(entry.time).slice(0, 5), now, gracePeriodMs, rows, messages);
      [10, 35].forEach((minutes, index) => {
        addTaskMoment(task, new Date(start.getTime() + minutes * 60000), index, todayKey, String(entry.time).slice(0, 5), now, gracePeriodMs, rows, messages);
      });
    });

    const fallbackTimes = ["09:30", "12:30", "16:30", "20:00"];
    fallback.slice(0, fallbackTimes.length).forEach((task, index) => {
      const start = zonedDateToUtc(todayKey, fallbackTimes[index], timezone);
      addTaskMoment(task, new Date(start.getTime() - 60000), -1, todayKey, fallbackTimes[index], now, gracePeriodMs, rows, messages);
      addTaskMoment(task, new Date(start.getTime() + 20 * 60000), 1, todayKey, fallbackTimes[index], now, gracePeriodMs, rows, messages);
    });
  }

  return rows;
}

function addTaskMoment(
  task: { id: string; user_id: string; title: string },
  scheduledFor: Date,
  messageIndex: number,
  todayKey: string,
  startTime: string,
  now: Date,
  gracePeriodMs: number,
  rows: RhythmNotification[],
  messages: Array<{ title: string; body: (taskTitle: string) => string }>
) {
  if (scheduledFor.getTime() < now.getTime() - gracePeriodMs) return;
  const startReminder = messageIndex < 0;
  const message = messages[Math.max(0, Math.min(messageIndex, messages.length - 1))];
  const momentKey = scheduledFor.toISOString().slice(11, 16).replace(":", "");
  rows.push({
    user_id: task.user_id,
    title: startReminder ? "Începe într-un minut" : message.title,
    body: startReminder ? `Următorul pas este „${task.title}”.` : message.body(task.title),
    target_url: `./index.html#/tasks?task=${encodeURIComponent(task.id)}&focus=1`,
    tag: startReminder ? `task-${task.id}` : `task-nudge-${task.id}`,
    notification_type: startReminder ? "task-start" : "task-nudge",
    source_id: task.id,
    dedupe_key: startReminder
      ? `task-start-${task.id}-${todayKey}-${startTime}`
      : `task-nudge-${task.id}-${todayKey}-${momentKey}`,
    scheduled_for: scheduledFor.toISOString(),
    status: "pending"
  });
}

async function isTaskStillOpen(taskId: string, userId: string) {
  const { data, error } = await admin
    .from("tasks")
    .select("completed")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && !data.completed);
}

async function userOpenedIteraAfterTaskStart(taskId: string, userId: string) {
  const { data: startReminder, error: reminderError } = await admin
    .from("notification_queue")
    .select("scheduled_for")
    .eq("user_id", userId)
    .eq("source_id", taskId)
    .eq("notification_type", "task-start")
    .order("scheduled_for", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reminderError || !startReminder?.scheduled_for) return false;

  const { data: activeDevice, error: subscriptionError } = await admin
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("enabled", true)
    .gte("last_seen_at", startReminder.scheduled_for)
    .limit(1)
    .maybeSingle();
  if (subscriptionError) throw subscriptionError;
  return Boolean(activeDevice);
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
  const ttl = payload.notificationType === "task-start"
    ? 120
    : payload.notificationType === "task-nudge" ? 600 : 3600;

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
