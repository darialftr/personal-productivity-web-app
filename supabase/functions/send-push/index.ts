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

    return json({ ok: true, processed: queue?.length || 0, sent, failed });
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
