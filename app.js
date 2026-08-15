(() => {
  const CFG = window.MEDIAHUB_CONFIG;
  const TOKEN_KEY = "reel_token";
  const TOKEN_EXP_KEY = "reel_token_exp";

  let accessToken = sessionStorage.getItem(TOKEN_KEY) || null;
  let tokenExpiry = Number(sessionStorage.getItem(TOKEN_EXP_KEY) || 0);
  let library = { video: [], photo: [], music: [] };
  let activeTab = "video";
  let activeFolder = "Tümü";
  let tokenClient = null;

  const $ = (sel) => document.querySelector(sel);
  const gate = $("#gate"), app = $("#app");
  const gateStatus = $("#gate-status");
  const grid = $("#grid"), emptyState = $("#empty-state"), loadingState = $("#loading-state");
  const chipsEl = $("#chips");
  const sectionTitle = $("#section-title"), sectionCount = $("#section-count");
  const searchInput = $("#search");
  const playerModal = $("#player-modal"), playerStage = $("#player-stage");
  const playerTitle = $("#player-title"), playerSub = $("#player-sub");

  const TAB_LABELS = { video: "Video", photo: "Fotoğraf", music: "Müzik" };

  // ---------- Service worker (proxies Drive streams with Range + auth) ----------
  let swReady = null;
  if ("serviceWorker" in navigator) {
    swReady = navigator.serviceWorker.register("sw.js").then((reg) => {
      return navigator.serviceWorker.ready.then(() => reg);
    });
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "SW_NEEDS_TOKEN") pushTokenToSW();
    });
  }
  function pushTokenToSW() {
    if (navigator.serviceWorker?.controller && accessToken) {
      navigator.serviceWorker.controller.postMessage({ type: "TOKEN", token: accessToken });
    }
  }

  // ---------- Auth ----------
  function haveValidToken() {
    return accessToken && Date.now() < tokenExpiry;
  }

  function initGis() {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: CFG.SCOPES,
      callback: (resp) => {
        if (resp.error) {
          gateStatus.textContent = "Giriş başarısız: " + resp.error;
          return;
        }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
        sessionStorage.setItem(TOKEN_KEY, accessToken);
        sessionStorage.setItem(TOKEN_EXP_KEY, String(tokenExpiry));
        pushTokenToSW();
        enterApp();
      },
    });
  }

  $("#signin-btn").addEventListener("click", () => {
    gateStatus.textContent = "Google hesabı seçiliyor…";
    tokenClient.requestAccessToken({ prompt: haveValidToken() ? "" : "consent" });
  });

  $("#signout-btn").addEventListener("click", () => {
    if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXP_KEY);
    accessToken = null; tokenExpiry = 0;
    app.classList.add("hidden");
    gate.classList.remove("hidden");
    gateStatus.textContent = "Çıkış yapıldı.";
  });

  $("#refresh-btn").addEventListener("click", () => loadLibrary(true));

  async function enterApp() {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    if (swReady) await swReady;
    pushTokenToSW();
    loadLibrary(false);
  }

  // ---------- Drive ----------
  function isMedia(mime) {
    return mime && (mime.startsWith("video/") || mime.startsWith("image/") || mime.startsWith("audio/"));
  }
  function bucketOf(mime) {
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("image/")) return "photo";
    return "music";
  }

  async function driveList(q, pageToken) {
    const params = new URLSearchParams({
      q,
      pageSize: "200",
      fields: "nextPageToken,files(id,name,mimeType,thumbnailLink,videoMediaMetadata,imageMediaMetadata,size,modifiedTime)",
      pageToken: pageToken || "",
    });
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) throw new Error("AUTH_EXPIRED");
    if (!res.ok) throw new Error("Drive isteği başarısız: " + res.status);
    return res.json();
  }

  async function getFolderName(folderId) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    return (await res.json()).name;
  }

  // Her dosyaya, doğrudan içinde bulunduğu klasörün adını "folderName" olarak
  // etiketler. Bu isim, ilgili sekmede klasör filtresi (chip) olarak kullanılır.
  async function listAllFiles() {
    const files = [];
    if (CFG.ROOT_FOLDER_ID) {
      const rootName = (await getFolderName(CFG.ROOT_FOLDER_ID)) || "Kök Klasör";
      const queue = [{ id: CFG.ROOT_FOLDER_ID, name: rootName }];
      while (queue.length) {
        const { id: folderId, name: folderName } = queue.shift();
        let pageToken = null;
        do {
          const data = await driveList(`'${folderId}' in parents and trashed=false`, pageToken);
          for (const f of data.files) {
            if (f.mimeType === "application/vnd.google-apps.folder") {
              queue.push({ id: f.id, name: f.name });
            } else if (isMedia(f.mimeType)) {
              f.folderName = folderName;
              files.push(f);
            }
          }
          pageToken = data.nextPageToken;
        } while (pageToken);
      }
    } else {
      let pageToken = null;
      do {
        const data = await driveList(
          "(mimeType contains 'video/' or mimeType contains 'image/' or mimeType contains 'audio/') and trashed=false",
          pageToken
        );
        for (const f of data.files) {
          f.folderName = "Drive";
          files.push(f);
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
    }
    return files;
  }

  async function loadLibrary(forceRefresh) {
    loadingState.classList.remove("hidden");
    emptyState.classList.add("hidden");
    grid.innerHTML = "";
    try {
      const files = await listAllFiles();
      library = { video: [], photo: [], music: [] };
      for (const f of files) library[bucketOf(f.mimeType)].push(f);
      for (const k in library) library[k].sort((a, b) => a.name.localeCompare(b.name, "tr"));
      renderTab();
    } catch (err) {
      if (err.message === "AUTH_EXPIRED") {
        loadingState.classList.add("hidden");
        tokenClient.requestAccessToken({ prompt: "" });
        return;
      }
      loadingState.classList.add("hidden");
      emptyState.textContent = "Bir hata oluştu: " + err.message;
      emptyState.classList.remove("hidden");
    }
  }

  // ---------- Rendering ----------
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;
      activeFolder = "Tümü";
      renderTab();
    });
  });
  searchInput.addEventListener("input", renderTab);

  function fmtDuration(ms) {
    if (!ms) return "";
    const s = Math.round(Number(ms) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  }

  function renderChips(allItems) {
    const folders = ["Tümü", ...new Set(allItems.map((f) => f.folderName).filter(Boolean))];
    chipsEl.innerHTML = "";
    if (folders.length <= 2) return; // tek klasörse chip göstermenin anlamı yok
    for (const name of folders) {
      const chip = document.createElement("button");
      chip.className = "chip" + (name === activeFolder ? " active" : "");
      chip.textContent = name;
      chip.addEventListener("click", () => {
        activeFolder = name;
        renderTab();
      });
      chipsEl.appendChild(chip);
    }
  }

  function renderTab() {
    loadingState.classList.add("hidden");
    sectionTitle.textContent = TAB_LABELS[activeTab];
    const allItems = library[activeTab];
    renderChips(allItems);

    const term = searchInput.value.trim().toLowerCase();
    let items = activeFolder === "Tümü" ? allItems : allItems.filter((f) => f.folderName === activeFolder);
    if (term) items = items.filter((f) => f.name.toLowerCase().includes(term));
    sectionCount.textContent = items.length ? `${items.length} öğe` : "";
    grid.innerHTML = "";
    emptyState.classList.toggle("hidden", items.length > 0);

    for (const f of items) {
      const card = document.createElement("button");
      card.className = "card";
      card.setAttribute("aria-label", f.name);

      if (activeTab === "music") {
        const div = document.createElement("div");
        div.className = "card-thumb audio";
        div.textContent = "♪";
        card.appendChild(div);
      } else if (f.thumbnailLink) {
        const img = document.createElement("img");
        img.className = "card-thumb";
        img.loading = "lazy";
        img.src = f.thumbnailLink;
        img.alt = "";
        card.appendChild(img);
      } else {
        const div = document.createElement("div");
        div.className = "card-thumb";
        card.appendChild(div);
      }

      const body = document.createElement("div");
      body.className = "card-body";
      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = f.name;
      const sub = document.createElement("div");
      sub.className = "card-sub";
      sub.textContent = fmtDuration(f.videoMediaMetadata?.durationMillis);
      body.appendChild(title);
      body.appendChild(sub);
      if (f.folderName && activeFolder === "Tümü") {
        const badge = document.createElement("span");
        badge.className = "folder-badge";
        badge.textContent = f.folderName;
        body.appendChild(badge);
      }
      card.appendChild(body);

      card.addEventListener("click", () => openPlayer(f));
      grid.appendChild(card);
    }
  }

  // ---------- Player ----------
  function streamUrl(fileId) {
    return `stream/${fileId}`;
  }

  function openPlayer(f) {
    pushTokenToSW();
    playerStage.innerHTML = "";
    playerTitle.textContent = f.name;
    playerSub.textContent = [f.mimeType, fmtDuration(f.videoMediaMetadata?.durationMillis)].filter(Boolean).join(" · ");

    let el;
    if (f.mimeType.startsWith("video/")) {
      el = document.createElement("video");
      el.controls = true;
      el.autoplay = true;
      el.playsInline = true;
      el.setAttribute("x-webkit-airplay", "allow");
      el.src = streamUrl(f.id);
    } else if (f.mimeType.startsWith("audio/")) {
      el = document.createElement("audio");
      el.controls = true;
      el.autoplay = true;
      el.setAttribute("x-webkit-airplay", "allow");
      el.src = streamUrl(f.id);
    } else {
      el = document.createElement("img");
      el.src = streamUrl(f.id);
      el.alt = f.name;
    }
    playerStage.appendChild(el);
    playerModal.classList.remove("hidden");
  }

  function closePlayer() {
    playerStage.innerHTML = "";
    playerModal.classList.add("hidden");
  }
  $("#player-close").addEventListener("click", closePlayer);
  playerModal.addEventListener("click", (e) => { if (e.target === playerModal) closePlayer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePlayer(); });

  // ---------- Boot ----------
  window.addEventListener("load", () => {
    const check = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(check);
        initGis();
        if (haveValidToken()) enterApp();
      }
    }, 50);
  });
})();
