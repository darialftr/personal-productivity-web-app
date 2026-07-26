"use strict";

(function (global) {
  let registration = null;
  let deferredInstallPrompt = null;
  let currentSubscription = null;

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = () =>
    global.matchMedia("(display-mode: standalone)").matches ||
    global.navigator.standalone === true;

  async function initialize() {
    const enableButton = document.getElementById("enablePushButton");
    const installButton = document.getElementById("installIteraButton");
    const testButton = document.getElementById("testPushButton");

    if (!enableButton || !("serviceWorker" in navigator) || !("PushManager" in global)) {
      updateUi("unsupported");
      return;
    }

    global.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      installButton.hidden = false;
    });

    enableButton.addEventListener("click", enablePush);
    installButton.addEventListener("click", installApp);
    testButton.addEventListener("click", sendTestNotification);

    try {
      registration = await navigator.serviceWorker.register("./service-worker.js", {
        scope: "./"
      });
      await navigator.serviceWorker.ready;
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
      document.getElementById("installIteraButton").hidden = false;
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
      "not-configured": ["Mai lipsește configurarea", "Cheile de notificare trebuie activate în Supabase.", "Reîncearcă"],
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

  global.IteraPush = Object.freeze({ initialize });
})(window);
