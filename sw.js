// Minimal service worker: caches the app shell so the form also opens
// offline once it has been visited once, and satisfies the installability
// requirement for "Add to Home screen" / desktop install.
const CACHE_NAME = "aishur-hazmana-v2";
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
// here; we stash it in IndexedDB (plain string keys — no base-URL
// resolution ambiguity between the SW and the page) and redirect into the
// app, which picks it up and loads it automatically (see index.html).
function openShareDB(){
  return new Promise((resolve, reject) => {
    var req = indexedDB.open("aishur-hazmana-share", 1);
    req.onupgradeneeded = function(){ req.result.createObjectStore("files"); };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error); };
  });
}
function saveSharedFile(file){
  return openShareDB().then(function(db){
    return new Promise(function(resolve, reject){
      var tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(
        { blob: file, filename: file.name || "shared.pdf", type: file.type || "application/pdf" },
        "pending-pdf"
      );
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ reject(tx.error); };
    });
  });
}
// Always records what actually happened while handling the share POST
// (even on failure), so the app can show it in its debug panel — we have
// no devtools access on the phone that's actually failing.
function saveShareDebug(info){
  return openShareDB().then(function(db){
    return new Promise(function(resolve){
      var tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(info, "share-debug");
      tx.oncomplete = function(){ resolve(); };
      tx.onerror = function(){ resolve(); };
    });
  }).catch(function(){});
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === "POST" && url.pathname.endsWith("/share-target")) {
    event.respondWith((async () => {
      var debug = { at: new Date().toISOString(), contentType: req.headers.get("Content-Type") || "(none)" };
      try {
        const formData = await req.formData();
        var keys = [];
        for (const pair of formData.entries()) {
          var val = pair[1];
          keys.push(pair[0] + "=" + (val instanceof File ? ("File(name=" + val.name + ", type=" + val.type + ", size=" + val.size + ")") : String(val).slice(0, 60)));
        }
        debug.formDataEntries = keys;
        const file = formData.get("pdf");
        if (file) {
          await saveSharedFile(file);
          debug.result = "saved pending-pdf ok";
        } else {
          debug.result = "no 'pdf' field in formData";
        }
      } catch (e) {
        debug.result = "error: " + (e && e.message ? e.message : String(e));
      }
      await saveShareDebug(debug);
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
