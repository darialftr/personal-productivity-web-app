"use strict";

const CACHE_NAME = "itera-shell-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./app-shell.js",
  "./schedule-view.js",
  "./tasks-view.js",
  "./calendar-view.js",
  "./subjects-view.js",
  "./progress-view.js",
  "./supabase-config.js",
  "./auth-guard.js",
  "./push-notifications.js",
  "./manifest.webmanifest",
  "./itera-icon.png",
  "./itera-icon-192.png",
  "./itera-icon-512.png"
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
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
  );
});

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
