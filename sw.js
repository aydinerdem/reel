// Reel — stream proxy service worker
// Intercepts requests to /stream/{fileId} and forwards them to the Drive API
// with the user's OAuth token + any Range header, so <video>/<audio>/<img>
// get real partial-content streaming and seeking without exposing the token
// in a URL.

self.token = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type === "TOKEN") self.token = event.data.token;
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const match = url.pathname.match(/\/stream\/([^/]+)$/);
  self.clients.matchAll().then((cs) => cs.forEach((c) =>
    c.postMessage({ type: "SW_DEBUG", pathname: url.pathname, matched: !!match })
  ));
  if (!match) return; // not ours, let the browser handle it normally
  event.respondWith(handleStream(match[1], event.request));
});

async function ensureToken() {
  if (self.token) return self.token;
  const clientsList = await self.clients.matchAll();
  for (const c of clientsList) c.postMessage({ type: "SW_NEEDS_TOKEN" });
  for (let i = 0; i < 30 && !self.token; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return self.token;
}

async function handleStream(fileId, request) {
  const token = await ensureToken();
  if (!token) {
    return new Response("Oturum bulunamadı. Sayfayı yenileyip tekrar giriş yapın.", { status: 401 });
  }

  const headers = { Authorization: `Bearer ${token}` };
  const range = request.headers.get("Range");
  if (range) headers["Range"] = range;

  let driveRes;
  try {
    driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers });
  } catch (err) {
    return new Response("Drive'a bağlanılamadı: " + err.message, { status: 502 });
  }

  if (driveRes.status === 401) {
    self.token = null;
    return new Response("Oturum süresi doldu. Sayfayı yenileyin.", { status: 401 });
  }
  if (!driveRes.ok && driveRes.status !== 206) {
    const bodyText = await driveRes.text().catch(() => "");
    return new Response("Drive hatası " + driveRes.status + ": " + bodyText.slice(0, 300), { status: driveRes.status });
  }

  const outHeaders = new Headers();
  for (const h of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"]) {
    const v = driveRes.headers.get(h);
    if (v) outHeaders.set(h, v);
  }
  return new Response(driveRes.body, { status: driveRes.status, headers: outHeaders });
}
