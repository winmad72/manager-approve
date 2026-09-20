// Minimal service worker: caches the app shell so the form also opens
// offline once it has been visited once, and satisfies the installability
// requirement for "Add to Home screen" / desktop install.
const CACHE_NAME = "aishur-hazmana-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./NotoSansHebrew-Regular.ttf",
  "./NotoSansHebrew-Bold.ttf",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// When the app is installed, Android offers it in the system "share" sheet
// for PDF files (via the manifest's share_target). Android posts the file
// here; we stash it in the Cache Storage API and redirect into the app,
// which picks it up and loads it automatically (see index.html).
const SHARE_CACHE = "shared-file-v1";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        const file = formData.get("pdf");
        if (file) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put("./shared-pdf", new Response(file, {
            headers: {
              "Content-Type": file.type || "application/pdf",
              "X-Filename": encodeURIComponent(file.name || "shared.pdf")
            }
          }));
        }
      } catch (e) { /* fall through to redirect regardless */ }
      return Response.redirect("./index.html?shared=1", 303);
    })());
    return;
  }

  if (req.method !== "GET") return;

  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  } else {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
