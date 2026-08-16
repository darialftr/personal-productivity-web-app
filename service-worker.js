"use strict";

const CACHE_NAME = "itera-shell-v83";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./apple-design.css?v=5",
  "./app.js",
  "./app-shell.js",
  "./schedule-view.js",
  "./tasks-view.js",
  "./calendar-view.js",
  "./subjects-view.js",
  "./progress-view.js",
  "./supabase-config.js",
  "./task-planning.js",
  "./auth-guard.js",
  "./push-notifications.js",
  "./manifest.webmanifest",
  "./itera-icon-192.png?v=3",
  "./itera-icon-512.png?v=3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const cacheableExternal = ["script", "style", "font"].includes(event.request.destination);

  if (!sameOrigin && !cacheableExternal) return;

  if (event.request.mode === "navigate") {
    event.respondWith(cacheFirstNavigation(event.request, event));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request, event));
});

async function cacheFirstNavigation(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match("./index.html");
  const refresh = fetch(request).then((response) => {
    if (response?.ok) cache.put("./index.html", response.clone());
    return response;
  }).catch(() => null);

  if (cached) {
    event.waitUntil(refresh.then(() => undefined));
    return cached;
  }

  return (await refresh) || Response.error();
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response && (response.ok || response.type === "opaque")) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cached) {
    event.waitUntil(refresh.then(() => undefined));
    return cached;
  }

  return (await refresh) || Response.error();
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || "Ai un reminder nou în Itera." };
  }

  const title = payload.title || "Itera";
  const options = {
    body: payload.body || "E timpul pentru următorul pas.",
    icon: "./itera-icon-192.png",
    badge: "./itera-icon-192.png",
    tag: payload.tag || "itera-reminder",
    renotify: Boolean(payload.renotify),
    data: {
      url: payload.url || "./index.html",
      notificationId: payload.notificationId || null
    },
    actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : []
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => self.registration.setAppBadge?.(payload.badgeCount || 1))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "./index.html", self.registration.scope).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.registration.scope));
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    }).then(() => self.registration.clearAppBadge?.())
  );
});
