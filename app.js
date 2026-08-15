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

  // ---------- Klasör ayarları (sekme başına) ----------
  const FOLDER_KEYS = { video: "reel_folder_video", photo: "reel_folder_photo", music: "reel_folder_music" };
  function getFolderId(tab) {
    return localStorage.getItem(FOLDER_KEYS[tab]) || "";
  }
  function setFolderId(tab, id) {
    if (id) localStorage.setItem(FOLDER_KEYS[tab], id);
    else localStorage.removeItem(FOLDER_KEYS[tab]);
  }
  function extractFolderId(input) {
    if (!input) return "";
    input = input.trim();
    const m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input;
    return "";
  }

  const foldersModal = $("#folders-modal");
  $("#folders-btn").addEventListener("click", () => {
    $("#folder-video").value = getFolderId("video");
    $("#folder-photo").value = getFolderId("photo");
    $("#folder-music").value = getFolderId("music");
    foldersModal.classList.remove("hidden");
  });
  $("#folders-cancel").addEventListener("click", () => foldersModal.classList.add("hidden"));
  $("#folders-save").addEventListener("click", () => {
    setFolderId("video", extractFolderId($("#folder-video").value));
    setFolderId("photo", extractFolderId($("#folder-photo").value));
    setFolderId("music", extractFolderId($("#folder-music").value));
    foldersModal.classList.add("hidden");
    loadLibrary(false);
  });

  // ---------- Kütüphane önbelleği ----------
  // Bir kez tarandıktan sonra sonuç localStorage'a yazılır. Sonraki açılışlarda
  // önce bu önbellek anında gösterilir, arka planda sessizce yeniden taranır ve
  // bittiğinde ekran güncellenir — böylece açılış hızlı olur ama içerik güncel
  // kalır. Yeni eklediğin bir dosyayı hemen görmek istersen "Yenile" ile
  // önbelleği atlayıp anında tazeleyebilirsin.
  const CACHE_KEY = "reel_library_cache";
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw).library : null;
    } catch { return null; }
  }
  function saveCache(lib) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ library: lib, ts: Date.now() })); } catch {}
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

  $("#refresh-btn").addEventListener("click", () => loadLibrary(false));

  async function enterApp() {
    gate.classList.add("hidden");
    app.classList.remove("hidden");
    if (swReady) await swReady;
    pushTokenToSW();
    const cached = loadCache();
    if (cached) {
      library = cached;
      renderTab();
      loadLibrary(true); // arka planda sessizce tazele
    } else {
      loadLibrary(false);
    }
  }

  // ---------- Drive ----------

  async function driveList(q, pageToken) {
    const params = new URLSearchParams({
      q,
      pageSize: "200",
      fields: "nextPageToken,files(id,name,mimeType,thumbnailLink,videoMediaMetadata,imageMediaMetadata,size,modifiedTime)",
      pageToken: pageToken || "",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
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
      `https://www.googleapis.com/drive/v3/files/${folderId}?fields=name&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    return (await res.json()).name;
  }

  const MIME_PREFIX = { video: "video/", photo: "image/", music: "audio/" };

  // Bir sekme için: klasör ayarlanmışsa o klasör ağacını SEVİYE SEVİYE, HER
  // SEVİYEDEKİ KLASÖRLERİ PARALEL olarak gezer (tek tek sırayla değil — bu,
  // çok sayıda alt klasör olduğunda taramayı büyük ölçüde hızlandırır).
  // Ayarlanmamışsa tüm Drive'da o mimeType'ı arar. Her dosyaya doğrudan
  // bulunduğu klasörün adını "folderName" olarak etiketler.
  async function listTab(tab, onProgress) {
    const prefix = MIME_PREFIX[tab];
    const rootId = getFolderId(tab);
    const files = [];

    if (rootId) {
      const rootName = (await getFolderName(rootId)) || "Kök Klasör";
      let currentLevel = [{ id: rootId, name: rootName }];
      let scanned = 0;
      while (currentLevel.length) {
        const results = await Promise.all(
          currentLevel.map(async ({ id: folderId, name: folderName }) => {
            const found = [], subfolders = [];
            let pageToken = null;
            do {
              const data = await driveList(`'${folderId}' in parents and trashed=false`, pageToken);
              for (const f of data.files) {
                if (f.mimeType === "application/vnd.google-apps.folder") {
                  subfolders.push({ id: f.id, name: f.name });
                } else if (f.mimeType && f.mimeType.startsWith(prefix)) {
                  f.folderName = folderName;
                  found.push(f);
                }
              }
              pageToken = data.nextPageToken;
            } while (pageToken);
            return { found, subfolders };
          })
        );
        scanned += currentLevel.length;
        onProgress?.(scanned);
        const nextLevel = [];
        for (const r of results) { files.push(...r.found); nextLevel.push(...r.subfolders); }
        currentLevel = nextLevel;
      }
    } else {
      let pageToken = null;
      do {
        const data = await driveList(`mimeType contains '${prefix}' and trashed=false`, pageToken);
        for (const f of data.files) {
          f.folderName = "Drive";
          files.push(f);
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
    }
    return files;
  }

  async function loadLibrary(silent) {
    if (!silent) {
      loadingState.classList.remove("hidden");
      loadingState.textContent = "Kütüphane taranıyor…";
      emptyState.classList.add("hidden");
      grid.innerHTML = "";
    }
    let scannedTotal = 0;
    const bump = () => {
      scannedTotal++;
      if (!silent) loadingState.textContent = `Kütüphane taranıyor… (${scannedTotal} klasör kontrol edildi)`;
    };
    try {
      const [video, photo, music] = await Promise.all([
        listTab("video", bump),
        listTab("photo", bump),
        listTab("music", bump),
      ]);
      library = { video, photo, music };
      for (const k in library) library[k].sort((a, b) => a.name.localeCompare(b.name, "tr"));
      saveCache(library);
      renderTab();
    } catch (err) {
      if (err.message === "AUTH_EXPIRED") {
        loadingState.classList.add("hidden");
        tokenClient.requestAccessToken({ prompt: "" });
        return;
      }
      if (!silent) {
        loadingState.classList.add("hidden");
        emptyState.textContent = "Bir hata oluştu: " + err.message;
        emptyState.classList.remove("hidden");
      }
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
      } else {
        const wrap = document.createElement("div");
        wrap.className = "thumb-wrap";
        if (f.thumbnailLink) {
          const img = document.createElement("img");
          img.className = "card-thumb";
          img.loading = "lazy";
          img.src = f.thumbnailLink;
          img.alt = "";
          wrap.appendChild(img);
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "card-thumb";
          wrap.appendChild(placeholder);
        }
        if (activeTab === "video") attachHoverPreview(wrap, f.id);
        card.appendChild(wrap);
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
      if (f.folderName) {
        const crumb = document.createElement("button");
        crumb.className = "folder-badge";
        crumb.textContent = "📁 " + f.folderName;
        crumb.type = "button";
        crumb.addEventListener("click", (e) => {
          e.stopPropagation();
          activeFolder = f.folderName;
          renderTab();
        });
        body.appendChild(crumb);
      }
      card.appendChild(body);

      card.addEventListener("click", () => {
        if (card.dataset.suppressClick === "1") { card.dataset.suppressClick = "0"; return; }
        openPlayer(f);
      });
      grid.appendChild(card);
    }
  }

  // Kartın üzerine gelince (masaüstü) ya da basılı tutunca (dokunmatik) kısa
  // bir önizleme oynatır. En fazla PREVIEW_MAX_MS kadar oynar, sonra durur.
  const PREVIEW_MAX_MS = 8000;
  const PREVIEW_HOLD_MS = 350;
  function attachHoverPreview(wrap, fileId) {
    const card = wrap.closest(".card");
    let previewEl = null, stopTimer = null, holdTimer = null, longPress = false;

    function start() {
      if (previewEl) return;
      previewEl = document.createElement("video");
      previewEl.className = "thumb-preview";
      previewEl.src = streamUrl(fileId);
      previewEl.muted = true;
      previewEl.playsInline = true;
      previewEl.autoplay = true;
      wrap.appendChild(previewEl);
      previewEl.play().catch(() => {});
      stopTimer = setTimeout(stop, PREVIEW_MAX_MS);
    }
    function stop() {
      clearTimeout(stopTimer);
      if (previewEl) { previewEl.pause(); previewEl.remove(); previewEl = null; }
    }

    wrap.addEventListener("mouseenter", start);
    wrap.addEventListener("mouseleave", stop);

    wrap.addEventListener("touchstart", () => {
      longPress = false;
      holdTimer = setTimeout(() => { longPress = true; start(); }, PREVIEW_HOLD_MS);
    }, { passive: true });
    wrap.addEventListener("touchend", () => {
      clearTimeout(holdTimer);
      if (longPress) { stop(); card.dataset.suppressClick = "1"; }
    });
    wrap.addEventListener("touchcancel", () => {
      clearTimeout(holdTimer);
      stop();
    });
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
      el.addEventListener("error", () => {
        const err = el.error;
        playerSub.textContent = "Oynatma hatası (kod " + (err?.code ?? "?") + "). Network sekmesinde 'stream/" + f.id + "' isteğine bak.";
      });
    } else if (f.mimeType.startsWith("audio/")) {
      el = document.createElement("audio");
      el.controls = true;
      el.autoplay = true;
      el.setAttribute("x-webkit-airplay", "allow");
      el.src = streamUrl(f.id);
      el.addEventListener("error", () => {
        const err = el.error;
        playerSub.textContent = "Oynatma hatası (kod " + (err?.code ?? "?") + "). Network sekmesinde 'stream/" + f.id + "' isteğine bak.";
      });
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
