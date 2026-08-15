"use strict";

(function (global) {
  let registration = null;
  let deferredInstallPrompt = null;
  let currentSubscription = null;
  const personalTaskOnlyMarker = "[itera:task-only]";
  const fixedPersonalTypes = ["personal", "selfcare", "home", "health", "errand"];
  const isPersonalEventLike = task =>
    fixedPersonalTypes.includes(task?.task_type) &&
    !String(task?.notes || "").includes(personalTaskOnlyMarker);

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = () =>
    global.matchMedia("(display-mode: standalone)").matches ||
    global.navigator.standalone === true;

  async function initialize() {
    const enableButton = document.getElementById("enablePushButton");
    const installButton = document.getElementById("installIteraButton");
    const testButton = document.getElementById("testPushButton");

    if (!("serviceWorker" in navigator)) {
      updateUi("unsupported");
      return;
    }

    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      global.location.reload();
    });

    try {
      registration = await navigator.serviceWorker.register("./service-worker.js", {
        scope: "./",
        updateViaCache: "none"
      });
      await registration.update();
      await navigator.serviceWorker.ready;
    } catch (error) {
      console.error("Itera service worker:", error);
      updateUi("error");
      return;
    }

    if (!enableButton || !("PushManager" in global)) {
      updateUi("unsupported");
      return;
    }

    global.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (installButton) installButton.hidden = false;
    });

    enableButton.addEventListener("click", enablePush);
    installButton?.addEventListener("click", installApp);
    testButton?.addEventListener("click", sendTestNotification);

    try {
      currentSubscription = await registration.pushManager.getSubscription();
      updateUi(currentSubscription ? "enabled" : "ready");
      if (currentSubscription) await persistSubscription(currentSubscription);
    } catch (error) {
      console.error("Itera service worker:", error);
      updateUi("error");
    }
  }

  async function enablePush() {
    if (isIos && !isStandalone()) {
      updateUi("ios-install");
      const installButton = document.getElementById("installIteraButton");
      if (installButton) installButton.hidden = false;
      return;
    }

    if (Notification.permission === "denied") {
      updateUi("denied");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      updateUi(permission === "denied" ? "denied" : "ready");
      return;
    }

    try {
      const publicKey = await getVapidPublicKey();
      currentSubscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await persistSubscription(currentSubscription);
      updateUi("enabled");
      void scheduleRhythmReminders();
      global.showToast?.("Notificările pe telefon sunt active.", "♡");
    } catch (error) {
      console.error("Itera push subscription:", error);
      updateUi("not-configured");
    }
  }

  async function getVapidPublicKey() {
    const { data, error } = await supabaseClient.functions.invoke("push-config");
    if (error || !data?.publicKey) {
      throw error || new Error("VAPID public key missing");
    }
    return data.publicKey;
  }

  async function persistSubscription(subscription) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;
    const json = subscription.toJSON();
    const { error } = await supabaseClient.from("push_subscriptions").upsert({
      user_id: session.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth_key: json.keys?.auth,
      user_agent: navigator.userAgent,
      enabled: true,
      last_seen_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (error) throw error;
  }

  async function sendTestNotification() {
    const { data, error } = await supabaseClient.functions.invoke("send-push", {
      body: {
        test: true,
        title: "Itera este gata 🌷",
        body: "Notificările funcționează. Următorul pas va veni la momentul potrivit.",
        url: "./index.html#/"
      }
    });
    if (error || !data?.ok) {
      global.showToast?.("Notificarea de test nu a putut fi trimisă.", "!");
      return;
    }
    global.showToast?.("Notificarea de test a fost trimisă.", "✓");
  }

  async function disableCurrentDevice() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const activeSubscription = currentSubscription
      || await registration?.pushManager?.getSubscription();
    if (!activeSubscription) return;

    await supabaseClient
      .from("push_subscriptions")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("user_id", session.user.id)
      .eq("endpoint", activeSubscription.endpoint);

    await activeSubscription.unsubscribe();
    currentSubscription = null;
  }

  async function queueReminder({
    title,
    body,
    scheduledFor,
    targetUrl = "./index.html#/",
    tag = "itera-reminder",
    notificationType = "reminder",
    sourceId = null,
    dedupeKey = null
  }) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return { ok: false, error: new Error("Missing session") };

    const scheduledDate = new Date(scheduledFor);
    if (Number.isNaN(scheduledDate.getTime())) {
      return { ok: false, error: new Error("Invalid reminder date") };
    }

    if (dedupeKey) {
      const { data: existing } = await supabaseClient
        .from("notification_queue")
        .select("status")
        .eq("user_id", session.user.id)
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (existing?.status === "sent") return { ok: true, alreadySent: true };
    }

    const { error } = await supabaseClient.from("notification_queue").upsert({
      user_id: session.user.id,
      title,
      body,
      target_url: targetUrl,
      tag,
      notification_type: notificationType,
      source_id: sourceId,
      dedupe_key: dedupeKey,
      scheduled_for: scheduledDate.toISOString(),
      status: "pending"
    }, { onConflict: "dedupe_key", ignoreDuplicates: false });

    return { ok: !error, error };
  }

  async function cancelTaskReminders(taskId) {
    if (!taskId) return { ok: true };
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return { ok: false, error: new Error("Missing session") };

    const { error } = await supabaseClient
      .from("notification_queue")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("user_id", session.user.id)
      .eq("source_id", taskId)
      .in("notification_type", ["task-reminder", "task-start", "task-deadline", "task-continuation"])
      .in("status", ["pending", "failed"]);
    try {
      const registration = await navigator.serviceWorker?.ready;
      const visibleNotifications = await registration?.getNotifications?.({ tag: `task-${taskId}` }) || [];
      visibleNotifications.forEach(notification => notification.close());
      const continuationNotifications = await registration?.getNotifications?.({ tag: `task-continuation-${taskId}` }) || [];
      continuationNotifications.forEach(notification => notification.close());
    } catch (_) {
      // Some browsers do not expose already displayed notifications.
    }
    return { ok: !error, error };
  }

  async function cancelTimerReminders(timerId) {
    if (!timerId) return { ok: true };
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return { ok: false, error: new Error("Missing session") };
    const { error } = await supabaseClient
      .from("notification_queue")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("user_id", session.user.id)
      .eq("source_id", timerId)
      .in("notification_type", ["focus-finished", "break-finished"])
      .in("status", ["pending", "failed"]);
    try {
      const readyRegistration = await navigator.serviceWorker?.ready;
      const visible = await readyRegistration?.getNotifications?.({ tag: "itera-active-timer" }) || [];
      visible.forEach(notification => notification.close());
    } catch (_) {}
    return { ok: !error, error };
  }

  async function showTimerStatus({ title, body }) {
    if (!("Notification" in global) || Notification.permission !== "granted") return false;
    try {
      const readyRegistration = registration || await navigator.serviceWorker.ready;
      await readyRegistration.showNotification(title, {
        body,
        icon: "./itera-icon-192.png",
        badge: "./itera-icon-192.png",
        tag: "itera-active-timer",
        renotify: false,
        silent: true,
        data: { url: "./index.html#/" }
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function scheduleRhythmReminders() {
    if (!("Notification" in global) || Notification.permission !== "granted") return [];
    try {
      const readyRegistration = registration || await navigator.serviceWorker.ready;
      currentSubscription ||= await readyRegistration.pushManager?.getSubscription();
      if (!currentSubscription) return [];
    } catch (_) {
      return [];
    }
    const jobs = [];
    const positiveStarts = [
      "Bună dimineața. Azi nu trebuie să faci totul dintr-odată.",
      "Un început calm, apoi primul pas. Itera este cu tine.",
      "Ai o zi nouă în față. Alege ce contează și începem ușor."
    ];
    for (let offset = 0; offset < 2; offset += 1) {
      const day = new Date();
      day.setDate(day.getDate() + offset);
      const dateKey = new Date(day.getTime() - day.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const weekend = [0, 6].includes(day.getDay());
      const morning = new Date(day);
      morning.setHours(weekend ? 9 : 7, weekend ? 0 : 15, 0, 0);
      if (morning.getTime() > Date.now()) {
        jobs.push(queueReminder({
          title: "O zi bună începe blând",
          body: positiveStarts[offset % positiveStarts.length],
          scheduledFor: morning,
          targetUrl: "./index.html#/",
          tag: `morning-${dateKey}`,
          notificationType: "morning-rhythm",
          dedupeKey: `morning-rhythm-${dateKey}`
        }));
      }
      [
        [22, 15, "Închidem ziua încet", "Mai ai timp să pui telefonul jos și să te pregătești de somn."],
        [22, 45, "Hei, chiar este timpul de odihnă", "Mâine îți va fi mai ușor dacă te culci acum."],
        [23, 15, "Ultimul reminder de la Itera", "Gata pentru azi. Lasă restul pe mâine și mergi la somn."]
      ].forEach(([hour, minute, title, body], index) => {
        const bedtime = new Date(day);
        bedtime.setHours(hour, minute, 0, 0);
        if (bedtime.getTime() <= Date.now()) return;
        jobs.push(queueReminder({
          title,
          body,
          scheduledFor: bedtime,
          targetUrl: "./index.html#/",
          tag: `bedtime-${dateKey}`,
          notificationType: "bedtime-rhythm",
          dedupeKey: `bedtime-rhythm-${dateKey}-${index}`
        }));
      });
    }
    return Promise.all(jobs);
  }

  async function scheduleTaskReminders(task) {
    if (!task?.id) return [];
    await cancelTaskReminders(task.id);
    if (isPersonalEventLike(task)) return [];
    if (!task.deadline_date || !task.deadline_time || task.completed) return [];

    const deadline = new Date(
      `${task.deadline_date}T${String(task.deadline_time || "09:00").slice(0, 5)}:00`
    );
    if (Number.isNaN(deadline.getTime())) return [];

    const isTest = task.task_type === "test";
    const isImportant = task.priority === "high";
    const reminderOffsets = isTest
      ? [24 * 60, 2 * 60, 1]
      : isImportant
        ? [24 * 60, 60, 1]
        : [1];
    const now = Date.now();

    return Promise.all(reminderOffsets
      .map((minutesBefore) => ({
        minutesBefore,
        scheduledFor: new Date(deadline.getTime() - minutesBefore * 60000)
      }))
      .filter((reminder) => deadline.getTime() > now && (
        reminder.scheduledFor.getTime() > now || reminder.minutesBefore === 1
      ))
      .map((reminder) => queueReminder({
        title: reminder.minutesBefore === 1
          ? "Începe într-un minut"
          : isTest ? "Test în curând" : isImportant ? "Task important" : "Reminder task",
        body: reminder.minutesBefore === 1
          ? `${task.title} · ${String(task.deadline_time).slice(0, 5)}`
          : `${task.title} · ${formatReminderDistance(reminder.minutesBefore)}`,
        scheduledFor: reminder.scheduledFor.getTime() > now
          ? reminder.scheduledFor
          : new Date(now + 3000),
        targetUrl: "./index.html#/tasks",
        tag: `task-${task.id}`,
        notificationType: reminder.minutesBefore === 1 ? "task-start" : "task-reminder",
        sourceId: task.id,
        dedupeKey: reminder.minutesBefore === 1
          ? `task-start-${task.id}-${task.deadline_date}-${String(task.deadline_time).slice(0, 5)}`
          : `task-${task.id}-${deadline.toISOString()}-${reminder.minutesBefore}`
      })));
  }

  async function scheduleTestEventReminders(event) {
    if (!event?.id || event.event_type !== "test" || !event.event_date) return [];
    const eventDate = new Date(
      `${event.event_date}T${String(event.start_time || "09:00").slice(0, 5)}:00`
    );
    if (Number.isNaN(eventDate.getTime())) return [];

    const now = Date.now();
    return Promise.all([24 * 60, 2 * 60]
      .map((minutesBefore) => ({
        minutesBefore,
        scheduledFor: new Date(eventDate.getTime() - minutesBefore * 60000)
      }))
      .filter((reminder) => reminder.scheduledFor.getTime() > now)
      .map((reminder) => queueReminder({
        title: "Test în curând",
        body: `${event.title} · ${formatReminderDistance(reminder.minutesBefore)}`,
        scheduledFor: reminder.scheduledFor,
        targetUrl: "./index.html#/calendar",
        tag: `test-${event.id}`,
        notificationType: "test-reminder",
        sourceId: event.id,
        dedupeKey: `test-${event.id}-${eventDate.toISOString()}-${reminder.minutesBefore}`
      })));
  }

  async function syncUpcomingReminders(tasks = [], events = []) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 8 * 86400000);
    const isUpcoming = (dateValue) => {
      const date = new Date(`${dateValue}T23:59:59`);
      return !Number.isNaN(date.getTime()) && date >= now && date <= cutoff;
    };

    const taskJobs = tasks
      .filter((task) => !task.completed && isUpcoming(task.deadline_date))
      .slice(0, 20)
      .map(scheduleTaskReminders);
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const overdueJobs = tasks
      .filter((task) => {
        const originalDate = task.original_deadline_date || task.deadline_date;
        return !task.completed && originalDate && originalDate < today && !isPersonalEventLike(task);
      })
      .slice(0, 5)
      .map((task) => queueReminder({
        title: "Acum: închide taskul restant",
        body: `Lasă următorul lucru pe mai târziu și rezolvă „${task.title}”. Începe cu primul pas.`,
        scheduledFor: new Date(Date.now() + 5000),
        targetUrl: "./index.html#/tasks",
        tag: `overdue-${task.id}`,
        notificationType: "task-reminder",
        sourceId: task.id,
        dedupeKey: `overdue-nudge-${task.id}-${today}`
      }));
    const eventJobs = events
      .filter((event) => event.event_type === "test" && isUpcoming(event.event_date))
      .slice(0, 10)
      .map(scheduleTestEventReminders);

    return Promise.all([...taskJobs, ...overdueJobs, ...eventJobs]);
  }

  function formatReminderDistance(minutes) {
    if (minutes >= 24 * 60) return "mâine";
    if (minutes >= 60) return `în ${Math.round(minutes / 60)} ore`;
    return `în ${minutes} minute`;
  }

  async function installApp() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      document.getElementById("installIteraButton").hidden = true;
      return;
    }

    if (isIos && !isStandalone()) {
      global.showToast?.("În Safari: Share → Add to Home Screen, apoi deschide Itera.", "↗");
    }
  }

  function updateUi(state) {
    const title = document.getElementById("pushSettingsTitle");
    const description = document.getElementById("pushSettingsDescription");
    const enableButton = document.getElementById("enablePushButton");
    const installButton = document.getElementById("installIteraButton");
    const testButton = document.getElementById("testPushButton");
    if (!title) return;

    const states = {
      ready: ["Notificări pe telefon", "Primește remindere chiar dacă Itera nu este deschisă.", "Activează"],
      enabled: ["Notificări active", "Acest dispozitiv este conectat la Itera.", "Active"],
      denied: ["Notificări blocate", "Activează permisiunea din setările browserului.", "Blocate"],
      unsupported: ["Notificări indisponibile", "Browserul acesta nu suportă Web Push.", "Indisponibil"],
      error: ["Conectare nereușită", "Reîncarcă pagina și încearcă din nou.", "Reîncearcă"],
      "not-configured": ["Notificări indisponibile momentan", "Serviciul de notificări nu este încă activ. Încearcă din nou mai târziu.", "Reîncearcă"],
      "ios-install": ["Instalează Itera întâi", "Pe iPhone, adaugă Itera pe Home Screen din meniul Share.", "După instalare"]
    };
    const [nextTitle, nextDescription, buttonText] = states[state] || states.ready;
    title.textContent = nextTitle;
    description.textContent = nextDescription;
    enableButton.textContent = buttonText;
    enableButton.disabled = ["enabled", "denied", "unsupported"].includes(state);
    testButton.hidden = state !== "enabled";
    if (state === "ios-install") installButton.hidden = false;
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = global.atob(base64);
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  global.IteraPush = Object.freeze({
    initialize,
    disableCurrentDevice,
    queueReminder,
    cancelTaskReminders,
    cancelTimerReminders,
    showTimerStatus,
    scheduleTaskReminders,
    scheduleTestEventReminders,
    syncUpcomingReminders,
    scheduleRhythmReminders
  });
})(window);
