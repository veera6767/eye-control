/* Optional offline cache: after the first visit the page also works without internet. */
const CACHE = "eye-control-v2";
const CORE = ["./", "index.html", "app.js", "logic.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function remember(req, res) {
  if (res && res.status === 200) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.url.includes("/mediapipe/")) {
    // big, never-changing files: cache first
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => remember(req, res))));
  } else {
    // page and scripts: network first so updates show up, cache as the offline fallback
    event.respondWith(fetch(req).then((res) => remember(req, res)).catch(() => caches.match(req)));
  }
});
