// eTRS service worker: makes the site installable and lets the app shell open offline.
// Record data (Google Apps Script) is NEVER cached, so statuses are always live.
const CACHE = "etrs-shell-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
const CDN_HOSTS = ["cdn.tailwindcss.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

const TAILWIND = "https://cdn.tailwindcss.com";
const FA_CSS = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";

// Save the libraries the page needs right at install time, so the app opens fully styled offline.
async function precacheLibraries(cache) {
  try { await cache.put(TAILWIND, await fetch(TAILWIND, { mode: "no-cors" })); } catch (e) {}
  try {
    const res = await fetch(FA_CSS);
    const css = await res.clone().text();
    await cache.put(FA_CSS, res);
    const fonts = [...css.matchAll(/url\(([^)]+\.woff2[^)]*)\)/g)].map((m) => new URL(m[1].replace(/["']/g, ""), FA_CSS).href);
    await Promise.all([...new Set(fonts)].map((u) => fetch(u).then((r) => cache.put(u, r)).catch(() => {})));
  } catch (e) {}
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(async (c) => { await c.addAll(SHELL); await precacheLibraries(c); })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Live data: always go to the network, never cache.
  if (url.hostname.endsWith("google.com") || url.hostname.endsWith("googleusercontent.com")) return;

  // Page itself: network first (so updates show up), fall back to cache when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Own files + CDN libraries: use cache, refresh in the background.
  if (url.origin === location.origin || CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req)
          .then((res) => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
          .catch(() => hit);
        return hit || refresh;
      })
    );
  }
});
