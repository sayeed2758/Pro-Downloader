(() => {
  "use strict";

  const cfg = window.PRO_DOWNLOADER_CONFIG || {};
  const KEY = "pro_downloader_state_v1";
  const defaultState = {
    theme: "light",
    settings: { quality:"best", preferAudio:false, askDownload:false, saveHistory:true, notifications:true },
    history: [], watched: [], bookmarks: [], favoriteSites: [], tabs: [
      {id:crypto.randomUUID(), title:"New Tab", url:"https://www.google.com", favicon:""}
    ],
    downloads: [],
    supportedSites: [
      {name:"Direct Media", domain:"direct", enabled:true, supportsVideo:true, supportsAudio:false, iconUrl:"", sortOrder:0}
    ],
    plans: [
      {id:"day",name:"1 Day",duration:"1 day",price:"₹10",enabled:true,sortOrder:1},
      {id:"monthly",name:"Monthly",duration:"30 days",price:"₹70",enabled:true,sortOrder:2},
      {id:"yearly",name:"Yearly",duration:"365 days",price:"₹699",enabled:true,sortOrder:3}
    ],
    user: null
  };

  const clone = x => JSON.parse(JSON.stringify(x));
  const loadState = () => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? Object.assign(clone(defaultState), JSON.parse(raw)) : clone(defaultState);
    } catch { return clone(defaultState); }
  };
  let state = loadState();
  let selectedResult = null;
  let selectedFormat = null;
  let activeDownloadTab = "active";
  let activeVideoTab = "all";
  let authMode = "signin";

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const save = () => { localStorage.setItem(KEY, JSON.stringify(state)); syncFirebaseUserData(); renderAll(); };
  const toast = (msg) => {
    const el = $("#toast"); el.textContent = msg; el.classList.add("show");
    clearTimeout(window.__toast); window.__toast = setTimeout(()=>el.classList.remove("show"), 2500);
  };
  const modal = (id, open=true) => $(id).classList.toggle("hidden", !open);
  const showLoader = (txt) => { $("#loaderText").textContent = txt; $("#loader").classList.remove("hidden"); };
  const hideLoader = () => $("#loader").classList.add("hidden");
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const safeUrl = (u) => { try { const x = new URL(String(u)); return ["http:","https:"].includes(x.protocol) ? x.toString() : ""; } catch { return ""; } };
  const placeholderImg = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#eeeeF4"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#85858f" font-family="Arial" font-size="28">Pro Downloader</text></svg>`);

  function applyTheme() {
    const theme = state.theme;
    const actual = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light") : theme;
    document.documentElement.setAttribute("data-theme", actual);
    $("#themeSelect").value = theme;
  }

  function showView(view) {
    $$(".view").forEach(v => v.classList.remove("active"));
    $(`#view-${view}`).classList.add("active");
    $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.viewTarget === view));
    if (view === "downloads") renderDownloads();
    if (view === "videos") renderVideos();
    if (view === "tabs") renderTabs();
    if (view === "history") renderHistory();
    if (view === "bookmarks") renderBookmarks();
    if (view === "profile") renderProfile();
    if (view === "premium") renderPlans();
  }

  function platformFromUrl(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./,"").toLowerCase();
      const found = state.supportedSites.find(s => s.enabled && h === s.domain || s.enabled && h.endsWith("." + s.domain));
      if (found) return found;
      if (/\.(mp4|webm|mov|m4v|m3u8)(\?.*)?$/i.test(new URL(url).pathname)) return {name:"Direct Media",domain:"direct",enabled:true};
      return null;
    } catch { return null; }
  }

  function validateUrl(url) {
    const clean = safeUrl(url);
    if (!clean) return {ok:false, message:"Please paste a valid link."};
    const platform = platformFromUrl(clean);
    if (!platform) return {ok:false, message:"This website is currently not supported."};
    return {ok:true, url:clean, platform};
  }

  async function api(path, opts={}) {
    const base = String(cfg.apiBaseUrl || "").replace(/\/+$/,"");
    if (!base) throw new Error("API base URL is not configured.");
    const token = await getIdTokenMaybe();
    const headers = Object.assign({"Content-Type":"application/json"}, opts.headers || {});
    if (token) headers.Authorization = "Bearer " + token;
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), Number(opts.timeout || 60000));
    try {
      const res = await fetch(base + path, {...opts, headers, signal:controller.signal});
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok || data.success === false) {
        const e = new Error(data.message || `Request failed (${res.status})`);
        e.code = data.code || "REQUEST_FAILED";
        throw e;
      }
      return data;
    } finally { clearTimeout(timer); }
  }

  async function resolveMedia(rawUrl) {
    const v = validateUrl(rawUrl);
    if (!v.ok) { toast(v.message); return; }
    showLoader("Checking link...");
    try {
      $("#loaderText").textContent = "Detecting website...";
      const data = await api("/api/resolve", {method:"POST", body:JSON.stringify({url:v.url}), timeout:65000});
      $("#loaderText").textContent = "Preparing download options...";
      selectedResult = data;
      selectedFormat = data.media?.find(m => m.downloadAvailable !== false) || data.media?.[0] || null;
      renderResult(data);
      modal("#resultModal", true);
      addHistory(data, v.url);
    } catch (err) {
      showError(err);
    } finally { hideLoader(); }
  }

  function showError(err) {
    const code = err.code || "REQUEST_FAILED";
    const map = {
      INVALID_URL:"Please paste a valid link.",
      UNSUPPORTED_PLATFORM:"This website is currently not supported.",
      MEDIA_NOT_FOUND:"No accessible media was found for this link.",
      PRIVATE_CONTENT:"This content appears to be private or access-restricted.",
      PROVIDER_ERROR:"The resolver provider could not process this link.",
      RATE_LIMITED:"Too many requests. Please try again later.",
      TIMEOUT:"The request timed out. Please try again.",
      AUTH_REQUIRED:"Sign in is required for this operation.",
      PREMIUM_REQUIRED:"This feature requires Premium.",
      SERVICE_MAINTENANCE:"Service maintenance is in progress."
    };
    $("#resultContent").innerHTML = `<div class="empty-state"><h2>Could not process this link</h2><p>${escapeHtml(map[code]||err.message||"Something went wrong.")}</p><button class="secondary-btn" data-close-modal="resultModal">Try Another Link</button><button class="link-btn" id="errorSupportedBtn">Check Supported Websites</button></div>`;
    modal("#resultModal", true);
  }

  function renderResult(data) {
    const media = Array.isArray(data.media) ? data.media : [];
    $("#resultContent").innerHTML = `
      <div class="result-header">
        <img src="${safeUrl(data.thumbnail)||placeholderImg}" onerror="this.src='${placeholderImg}'" alt="">
        <div class="result-meta">
          <strong id="resultTitle">${escapeHtml(data.title||"Untitled media")}</strong>
          <small>${escapeHtml(data.platform||"Unknown platform")} ${data.author ? "· "+escapeHtml(data.author):""}</small>
          <small>${data.duration ? `Duration: ${Math.round(Number(data.duration))}s` : ""}</small>
        </div>
      </div>
      <div class="section-head" style="margin-top:18px"><h2>Select format</h2><span class="muted-note">${media.length} option(s)</span></div>
      <div class="format-grid" id="formatGrid">
        ${media.map((m,i)=>`<button class="format-card ${selectedFormat===m||(!selectedFormat&&i===0)?"selected":""}" data-format-id="${escapeHtml(String(m.id??i))}">
          <strong>${escapeHtml(m.quality||m.label||"Media")}</strong>
          <small>${escapeHtml(m.label||"")} · ${escapeHtml(m.format||m.type||"")}${m.size ? " · "+formatBytes(m.size):""}</small>
        </button>`).join("") || `<div class="empty-state" style="grid-column:1/-1">No formats returned.</div>`}
      </div>
      <div class="result-actions">
        <button class="primary-btn" id="resultDownloadBtn" ${selectedFormat?.downloadAvailable===false||!selectedFormat?"disabled":""}>Download</button>
        <button class="secondary-btn" id="resultPlayBtn" ${selectedFormat?.playAvailable===false||!selectedFormat?"disabled":""}>Play Online</button>
      </div>`;
    $$("#formatGrid .format-card").forEach(btn => btn.addEventListener("click",()=> {
      const id = btn.dataset.formatId;
      selectedFormat = media.find((m,i)=>String(m.id??i)===id) || null;
      renderResult(data);
    }));
    $("#resultDownloadBtn")?.addEventListener("click", startDownload);
    $("#resultPlayBtn")?.addEventListener("click", playSelected);
  }

  function formatBytes(n) {
    const num = Number(n); if (!Number.isFinite(num)) return "";
    const u = ["B","KB","MB","GB"]; let x=num,i=0;
    while (x>=1024&&i<u.length-1){x/=1024;i++;}
    return `${x.toFixed(i?1:0)} ${u[i]}`;
  }

  async function startDownload() {
    if (!selectedResult || !selectedFormat) return toast("Select a format first.");
    if (state.settings.askDownload && !confirm("Start this download?")) return;
    if (selectedFormat.downloadAvailable===false || !selectedFormat.downloadUrl) return toast("Download link unavailable.");
    try {
      const data = await api("/api/task", {method:"POST", body:JSON.stringify({
        sourceUrl:selectedResult.sourceUrl || selectedResult.url || "",
        title:selectedResult.title||"Media",
        platform:selectedResult.platform||"unknown",
        format:selectedFormat
      })});
      const task = Object.assign({
        id:data.taskId, createdAt:Date.now(), status:"processing", progress:null,
        title:selectedResult.title||"Media", platform:selectedResult.platform||"unknown",
        quality:selectedFormat.quality||selectedFormat.label||"", format:selectedFormat.format||"",
        thumbnail:selectedResult.thumbnail||"", downloadUrl:selectedFormat.downloadUrl||""
      }, data.task || {});
      state.downloads.unshift(task);
      save();
      modal("#resultModal", false);
      toast("Download task started.");
      showView("downloads");
      pollTask(task.id);
    } catch (err) { toast(err.message || "Could not start download."); }
  }

  async function pollTask(taskId) {
    try {
      const data = await api(`/api/task/${encodeURIComponent(taskId)}`, {method:"GET", timeout:20000});
      const t = state.downloads.find(x=>x.id===taskId);
      if (t) {
        Object.assign(t, data.task || {});
        save();
        if (t.status === "processing" || t.status === "downloading") setTimeout(()=>pollTask(taskId), 1500);
      }
    } catch {}
  }

  function playSelected() {
    if (!selectedFormat?.downloadUrl) return toast("Online playback unavailable.");
    const url = safeUrl(selectedFormat.downloadUrl);
    if (!url) return toast("Playback URL unavailable.");
    const w = window.open(url,"_blank","noopener,noreferrer");
    if (!w) toast("Please allow popups to open playback.");
    state.watched.unshift({
      id:crypto.randomUUID(), title:selectedResult.title||"Video", thumbnail:selectedResult.thumbnail||"",
      url, progress:0, lastWatched:Date.now(), platform:selectedResult.platform||"unknown", duration:selectedResult.duration||0
    });
    state.watched = state.watched.slice(0,100); save();
  }

  function addHistory(data,url) {
    if (!state.settings.saveHistory) return;
    state.history.unshift({id:crypto.randomUUID(), title:data.title||"Untitled", thumbnail:data.thumbnail||"", platform:data.platform||"unknown", url, date:Date.now(), status:"success"});
    state.history = state.history.slice(0,200); save();
  }

  async function clipboardPaste(targetInput) {
    try {
      if (!navigator.clipboard?.readText) throw new Error("Clipboard API unavailable");
      const text = await navigator.clipboard.readText();
      targetInput.value = text;
      targetInput.focus();
      toast("Link pasted.");
    } catch {
      toast("Clipboard permission unavailable. Please paste manually.");
    }
  }

  let qrScanner = null;
  async function openQr(inputEl) {
    modal("#qrModal", true);
    try {
      if (qrScanner) { await qrScanner.clear().catch(()=>{}); }
      qrScanner = new Html5Qrcode("qrReader");
      await qrScanner.start({facingMode:"environment"}, {fps:10, qrbox:220},
        async decodedText => {
          inputEl.value = decodedText;
          await qrScanner.stop().catch(()=>{});
          modal("#qrModal", false);
          toast("QR link scanned.");
        }, () => {});
    } catch (e) {
      $("#qrReader").innerHTML = `<div class="empty-state">Camera scanner could not start. Use manual paste instead.</div>`;
    }
  }

  function renderDownloads() {
    const filtered = state.downloads.filter(t => activeDownloadTab==="active" ? ["queued","processing","downloading"].includes(t.status) : activeDownloadTab==="completed" ? t.status==="completed" : t.status==="failed");
    $("#downloadsList").innerHTML = filtered.length ? filtered.map(t=>`
      <div class="download-task">
        <img class="thumb" src="${safeUrl(t.thumbnail)||placeholderImg}" onerror="this.src='${placeholderImg}'">
        <div class="item-main"><strong>${escapeHtml(t.title||"Untitled")}</strong><small>${escapeHtml(t.platform||"")} · ${escapeHtml(t.quality||"")} · ${escapeHtml(t.format||"")}</small>${t.progress!=null?`<div class="progress"><span style="width:${Math.min(100,Math.max(0,t.progress))}%"></span></div>`:""}<small>${escapeHtml(t.status||"")}${t.error?` · ${escapeHtml(t.error)}`:""}</small></div>
        <div class="item-actions">${t.downloadUrl&&t.status==="completed"?`<button class="mini-btn" data-open-download="${escapeHtml(t.downloadUrl)}">Open</button>`:""}<button class="mini-btn danger" data-delete-download="${t.id}">Delete</button></div>
      </div>`).join("") : `<div class="empty-state">No ${activeDownloadTab} downloads.</div>`;
  }

  function renderVideos() {
    let list = [...state.watched];
    if (activeVideoTab === "recent") list.sort((a,b)=>b.lastWatched-a.lastWatched);
    if (activeVideoTab === "favorites") list = list.filter(x=>x.favorite);
    $("#videosList").innerHTML = list.length ? list.map(v=>`<article class="video-card">
      <img src="${safeUrl(v.thumbnail)||placeholderImg}" onerror="this.src='${placeholderImg}'">
      <div class="body"><strong>${escapeHtml(v.title)}</strong><small>${escapeHtml(v.platform)} · ${v.lastWatched?new Date(v.lastWatched).toLocaleString():""}</small>
      <div class="actions"><button class="mini-btn" data-play-url="${escapeHtml(v.url)}">Play</button><button class="mini-btn" data-toggle-fav="${v.id}">${v.favorite?"★":"☆"}</button><button class="mini-btn" data-delete-watched="${v.id}">Delete</button></div></div></article>`).join("") : `<div class="empty-state" style="grid-column:1/-1">No saved videos yet.</div>`;
  }

  function renderTabs() {
    $("#tabsList").innerHTML = state.tabs.length ? state.tabs.map(t=>`<div class="tab-item"><div class="item-main"><strong>${escapeHtml(t.title||"Tab")}</strong><small>${escapeHtml(t.url||"")}</small></div><div class="item-actions"><button class="mini-btn" data-open-tab="${t.id}">Open</button><button class="mini-btn" data-delete-tab="${t.id}">Close</button></div></div>`).join("") : `<div class="empty-state">No tabs.</div>`;
  }

  function renderHistory() {
    $("#historyList").innerHTML = state.history.length ? state.history.map(h=>`<div class="history-item"><img class="thumb" src="${safeUrl(h.thumbnail)||placeholderImg}" onerror="this.src='${placeholderImg}'"><div class="item-main"><strong>${escapeHtml(h.title)}</strong><small>${escapeHtml(h.platform)} · ${new Date(h.date).toLocaleString()}</small><small>${escapeHtml(h.url)}</small></div><div class="item-actions"><button class="mini-btn" data-reprocess-history="${h.id}">Process</button><button class="mini-btn danger" data-delete-history="${h.id}">Delete</button></div></div>`).join("") : `<div class="empty-state">Your download history is empty.</div>`;
  }

  function renderBookmarks() {
    $("#bookmarksList").innerHTML = state.bookmarks.length ? state.bookmarks.map(b=>`<div class="bookmark-item"><div class="item-main"><strong>${escapeHtml(b.title)}</strong><small>${escapeHtml(b.url)}</small></div><div class="item-actions"><button class="mini-btn" data-open-bookmark="${b.id}">Open</button><button class="mini-btn danger" data-delete-bookmark="${b.id}">Delete</button></div></div>`).join("") : `<div class="empty-state">No bookmarks yet.</div>`;
  }

  function renderFavorites() {
    $("#favoriteSites").innerHTML = state.favoriteSites.length ? state.favoriteSites.map(s=>`<button class="favorite-site" data-favorite-url="${escapeHtml(s.siteUrl)}"><img src="${safeUrl(s.iconUrl)||placeholderImg}" onerror="this.src='${placeholderImg}'"><strong>${escapeHtml(s.siteName)}</strong></button>`).join("") : `<div class="empty-state" style="width:100%">No favorite sites. Add them from Admin or use Edit.</div>`;
  }

  function renderSupportedSites() {
    const list = state.supportedSites.filter(x=>x.enabled).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    $("#supportedSitesPreview").innerHTML = list.slice(0,8).map(x=>`<span class="site-chip">${escapeHtml(x.name)}</span>`).join("") || `<span class="site-chip">Direct Media</span>`;
    $("#supportedSitesGrid").innerHTML = list.length ? list.map(x=>`<div class="supported-card"><img src="${safeUrl(x.iconUrl)||placeholderImg}" onerror="this.src='${placeholderImg}'"><div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml(x.domain)}</small></div></div>`).join("") : `<div class="empty-state" style="grid-column:1/-1">No websites are enabled yet.</div>`;
  }

  function renderProfile() {
    const u = state.user;
    $("#profileCard").innerHTML = u ? `<div class="setting-row" style="background:transparent;border:0;padding:0"><div><strong>${escapeHtml(u.displayName||u.email||"User")}</strong><small>${escapeHtml(u.email||"")}</small></div><span>${u.isPremium?"Premium":"Free"}</span></div>` : `<div class="empty-state"><h3>Guest mode</h3><p>Sign in to sync history, bookmarks and premium status.</p><button class="primary-btn" id="signInBtn">Sign in</button></div>`;
    $("#signInBtn")?.addEventListener("click",()=>openAuth("signin"));
  }

  function openAuth(mode="signin"){
    authMode=mode;
    $("#authTitle").textContent=mode==="signin"?"Sign in":"Create account";
    $("#authSubtitle").textContent=mode==="signin"?"Sign in to sync history, bookmarks and premium status.":"Create a Firebase account to sync your data.";
    $("#authPrimaryBtn").textContent=mode==="signin"?"Sign in":"Create account";
    $("#authModeBtn").textContent=mode==="signin"?"Create account":"Back to sign in";
    $("#authMessage").textContent="";
    modal("#authModal",true);
  }

  async function handleAuthSubmit(){
    const email=$("#authEmail").value.trim(), password=$("#authPassword").value;
    if(!email||!password) return $("#authMessage").textContent="Email and password are required.";
    if(!window.__firebaseAuth) return $("#authMessage").textContent="Firebase is not configured yet.";
    $("#authMessage").textContent="Working…";
    try{
      let cred;
      if(authMode==="signin") cred=await window.__firebaseAuth.signInWithEmailAndPassword(email,password);
      else cred=await window.__firebaseAuth.createUserWithEmailAndPassword(email,password);
      const uid=cred.user.uid;
      if(window.__firebaseDb){
        await window.__firebaseDb.ref("users/"+uid).update({
          name:cred.user.displayName||"",
          email:cred.user.email||"",
          createdAt:firebase.database.ServerValue.TIMESTAMP
        });
      }
      modal("#authModal",false);
      toast(authMode==="signin"?"Signed in.":"Account created.");
    }catch(e){$("#authMessage").textContent=e.message||"Authentication failed."}
  }

  async function handleForgotPassword(){
    const email=$("#authEmail").value.trim();
    if(!email) return $("#authMessage").textContent="Enter your email first.";
    if(!window.__firebaseAuth) return $("#authMessage").textContent="Firebase is not configured yet.";
    try{await window.__firebaseAuth.sendPasswordResetEmail(email);$("#authMessage").textContent="Password reset email sent if the account exists."}
    catch(e){$("#authMessage").textContent=e.message||"Could not send password reset."}
  }

  async function deleteAccount(){
    const user=window.__firebaseAuth?.currentUser;
    if(!user) return toast("Sign in to delete your account.");
    if(!confirm("Delete your account and synced application data? This cannot be undone.")) return;
    try{
      if(window.__firebaseDb){
        for(const p of ["users","downloadHistory","bookmarks","favoriteSites","watched"]){
          await window.__firebaseDb.ref(p+"/"+user.uid).remove();
        }
      }
      await user.delete();
      state.user=null; state.history=[]; state.bookmarks=[]; state.watched=[]; save();
      showView("home"); toast("Account deleted.");
    }catch(e){
      toast(e.code==="auth/requires-recent-login"?"For security, sign in again before deleting the account.":(e.message||"Account deletion failed."));
    }
  }

  function renderPremiumCard() {
    const premium = !!state.user?.isPremium;
    $("#premiumCard").innerHTML = `<div><strong>${premium?"♛ You are a premium user":"Upgrade to Premium"}</strong><p>${premium?"Premium access is active.":"Higher quotas and premium-only features where supported."}</p></div><button class="premium-cta" id="homePremiumCta">${premium?"View":"Upgrade"}</button>`;
    $("#homePremiumCta").onclick = ()=>showView("premium");
  }

  function renderPlans() {
    $("#plansGrid").innerHTML = state.plans.filter(p=>p.enabled).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).map((p,i)=>`<button class="plan-card ${i===1?"selected":""}" data-plan-id="${p.id}"><strong>${escapeHtml(p.name)}</strong><div class="price">${escapeHtml(p.price)}</div><small>${escapeHtml(p.duration||"")}</small></button>`).join("");
    $$("#plansGrid .plan-card").forEach(b=>b.onclick=()=>{$$("#plansGrid .plan-card").forEach(x=>x.classList.remove("selected"));b.classList.add("selected")});
  }

  function renderAll(){applyTheme();renderPremiumCard();renderSupportedSites();renderFavorites();renderRecent();renderDownloads();renderVideos();renderTabs();renderHistory();renderBookmarks();renderProfile();syncFormSettings();}
  function renderRecent(){ const list=[...state.watched].sort((a,b)=>b.lastWatched-a.lastWatched).slice(0,10); $("#recentWatched").innerHTML=list.length?list.map(v=>`<article class="video-mini" data-play-url="${escapeHtml(v.url)}"><img src="${safeUrl(v.thumbnail)||placeholderImg}" onerror="this.src='${placeholderImg}'"><div class="body"><strong>${escapeHtml(v.title)}</strong><small>${escapeHtml(v.platform)}</small></div></article>`).join(""):`<div class="empty-state" style="width:100%">Nothing watched yet.</div>`; }
  function syncFormSettings(){ $("#qualitySelect").value=state.settings.quality; $("#preferAudioToggle").checked=state.settings.preferAudio; $("#askDownloadToggle").checked=state.settings.askDownload; $("#saveHistoryToggle").checked=state.settings.saveHistory; $("#notificationsToggle").checked=state.settings.notifications; }

  function addTab(url,title="New Tab"){ const clean=safeUrl(url)||"https://www.google.com"; state.tabs.unshift({id:crypto.randomUUID(),title,url:clean,favicon:""}); state.tabs=state.tabs.slice(0,30); save(); }
  function addBookmark(){ const url=prompt("Enter URL"); const clean=safeUrl(url||""); if(!clean) return toast("Please enter a valid URL."); const title=prompt("Title","Saved Link")||"Saved Link"; state.bookmarks.unshift({id:crypto.randomUUID(),title,url:clean,createdAt:Date.now()}); save(); }
  function openSafe(url){ const clean=safeUrl(url); if(!clean) return toast("Invalid URL."); window.open(clean,"_blank","noopener,noreferrer"); }

  function showTool(tool){
    const content = $("#toolContent");
    if(tool==="link-checker"){
      content.innerHTML=`<h2>Link Checker</h2><p>Inspect a public URL through the backend.</p><div class="url-input-wrap"><input id="toolUrl" placeholder="https://example.com"></div><button class="primary-btn" id="toolRunLink">Check Link</button><div id="toolOutput" class="tool-output hidden"></div>`;
      $("#toolRunLink").onclick=async()=>{const u=safeUrl($("#toolUrl").value);if(!u)return toast("Invalid URL.");$("#toolOutput").classList.remove("hidden");$("#toolOutput").textContent="Checking...";try{const r=await api("/api/link-check",{method:"POST",body:JSON.stringify({url:u})});$("#toolOutput").innerHTML=`<strong class="status-ok">Valid</strong><br>Domain: ${escapeHtml(r.domain)}<br>Protocol: ${escapeHtml(r.protocol)}<br>Reachable: ${r.reachable?"Yes":"No"}<br>Supported downloader site: ${r.supported?"Yes":"No"}`;}catch(e){$("#toolOutput").innerHTML=`<strong class="status-bad">Could not check</strong><br>${escapeHtml(e.message)}`;}}; 
    } else if(tool==="extract-audio"){
      content.innerHTML=`<h2>Extract Audio</h2><p>Paste a supported public media URL. The backend/provider must actually return audio formats.</p><div class="url-input-wrap"><input id="toolAudioUrl" placeholder="Video or post link"></div><button class="primary-btn" id="toolRunAudio">Resolve Audio</button><div id="toolOutput" class="tool-output hidden"></div>`;
      $("#toolRunAudio").onclick=async()=>{const u=$("#toolAudioUrl").value.trim();const v=validateUrl(u);if(!v.ok)return toast(v.message);$("#toolOutput").classList.remove("hidden");$("#toolOutput").textContent="Processing...";try{const r=await api("/api/resolve",{method:"POST",body:JSON.stringify({url:u,audioOnly:true}),timeout:65000});const aud=(r.media||[]).filter(m=>/mp3|m4a|audio/i.test((m.format||"")+" "+(m.type||"")));$("#toolOutput").innerHTML=aud.length?aud.map(a=>`<div style="margin:8px 0"><strong>${escapeHtml(a.format||a.type)}</strong> · ${escapeHtml(a.quality||a.label||"Audio")} <button class="mini-btn" data-audio-url="${escapeHtml(a.downloadUrl||"")}">Open</button></div>`).join(""):`No audio format was returned.`;}catch(e){$("#toolOutput").textContent=e.message;}}; 
    } else if(tool==="speed-test"){
      content.innerHTML=`<h2>Internet Speed Test</h2><p>Runs a simple browser-based download/upload latency test against the configured test endpoint.</p><button class="primary-btn" id="runSpeed">Start</button><div id="toolOutput" class="tool-output hidden"></div>`;
      $("#runSpeed").onclick=runSpeedTest;
    } else {
      content.innerHTML=`<h2>Status Saver</h2><p>This web application cannot access private WhatsApp/device storage. Status saving is only available where the browser and source technically expose a lawful public resource.</p>`;
    }
    modal("#toolModal",true);
  }

  async function runSpeedTest(){
    const out=$("#toolOutput"); out.classList.remove("hidden"); out.textContent="Measuring...";
    const base=String(cfg.apiBaseUrl||"").replace(/\/+$/,"");
    if(!base) return out.textContent="Configure the backend API first.";
    const start=performance.now();
    try{
      const r=await fetch(base+"/api/speed-test?bytes=2000000",{cache:"no-store"});
      const buf=await r.arrayBuffer();
      const sec=(performance.now()-start)/1000; const mbps=(buf.byteLength*8/sec/1e6).toFixed(2);
      out.innerHTML=`Download test: <strong>${mbps} Mbps</strong><br>Latency: <strong>${Math.round(sec*1000)} ms</strong><br><small>This is an approximate browser download test, not a laboratory-grade speed test.</small>`;
    }catch(e){out.textContent="Speed test unavailable: "+e.message}
  }

  async function getIdTokenMaybe(){
    try{
      if(window.__firebaseAuth?.currentUser) return await window.__firebaseAuth.currentUser.getIdToken();
    }catch{}
    return "";
  }

  async function initFirebase(){
    const f=cfg.firebase;
    const placeholder = !f || String(f.apiKey||"").startsWith("YOUR_");
    if(placeholder || !window.firebase) return;
    try{
      const app = window.firebase.initializeApp(f);
      window.__firebaseAuth = window.firebase.auth();
      window.__firebaseDb = window.firebase.database();
      window.__firebaseAuth.onAuthStateChanged(async user=>{
        if(user){
          const snap=await window.__firebaseDb.ref("users/"+user.uid).once("value");
          const data=snap.val()||{};
          state.user={uid:user.uid,email:user.email||"",displayName:data.name||user.displayName||"",isPremium:!!data.premium?.isPremium,expiresAt:data.premium?.expiresAt||null};
          renderAll();
        } else { state.user=null; renderProfile(); renderPremiumCard(); }
      });
    }catch(e){ console.warn("Firebase init failed",e); }
  }

  async function syncFirebaseUserData(){
    if(!window.__firebaseDb || !window.__firebaseAuth?.currentUser) return;
    const uid=window.__firebaseAuth.currentUser.uid;
    try{
      await window.__firebaseDb.ref("users/"+uid).update({
        name: state.user?.displayName || window.__firebaseAuth.currentUser.displayName || "",
        email: window.__firebaseAuth.currentUser.email || "",
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      });
      await window.__firebaseDb.ref("downloadHistory/"+uid).set(Object.fromEntries(state.history.map(x=>[x.id,x])));
      await window.__firebaseDb.ref("bookmarks/"+uid).set(Object.fromEntries(state.bookmarks.map(x=>[x.id,x])));
      await window.__firebaseDb.ref("favoriteSites/"+uid).set(Object.fromEntries(state.favoriteSites.map(x=>[x.id||crypto.randomUUID(),x])));
    }catch(e){console.warn("Firebase sync failed",e)}
  }

  async function loadPublicFirebase(){
    if(!window.__firebaseDb) return;
    try{
      const [sites,plans,settings] = await Promise.all([
        window.__firebaseDb.ref("supportedSites").once("value"),
        window.__firebaseDb.ref("premiumPlans").once("value"),
        window.__firebaseDb.ref("settings/public").once("value")
      ]);
      const siteData=sites.val(); if(siteData) state.supportedSites=Object.values(siteData).filter(Boolean);
      const planData=plans.val(); if(planData) state.plans=Object.values(planData).filter(Boolean);
      const publicSettings=settings.val(); if(publicSettings) Object.assign(cfg, publicSettings);
      save();
    }catch(e){console.warn("Public Firebase load failed",e)}
  }

  function bind(){
    $$(".nav-item,[data-view-target]").forEach(el=>el.addEventListener("click",e=>{e.preventDefault();showView(el.dataset.viewTarget);}));
    $("#premiumTopBtn").onclick=()=>showView("premium");$("#premiumDownloaderBtn").onclick=()=>showView("premium");$("#settingsTopBtn").onclick=()=>showView("settings");
    $("#homeResolveForm").onsubmit=e=>{e.preventDefault();resolveMedia($("#homeUrlInput").value.trim())};
    $("#downloadForm").onsubmit=e=>{e.preventDefault();resolveMedia($("#downloadUrlInput").value.trim())};
    $("#pasteHomeBtn").onclick=()=>clipboardPaste($("#homeUrlInput"));$("#pasteDownloadBtn").onclick=()=>clipboardPaste($("#downloadUrlInput"));
    $("#scanHomeBtn").onclick=()=>openQr($("#homeUrlInput"));$("#scanDownloadBtn").onclick=()=>openQr($("#downloadUrlInput"));
    $("#scanHomeBtn").addEventListener("dblclick",()=>modal("#pasteHelperModal",true));
    $("#pasteHelperBtn").onclick=()=>clipboardPaste($("#helperUrlInput"));$("#helperContinueBtn").onclick=()=>{modal("#pasteHelperModal",false);$("#homeUrlInput").value=$("#helperUrlInput").value;$("#homeResolveForm").requestSubmit()};
    $("#telegramFab").onclick=()=>openSafe(cfg.telegramUrl||"https://t.me/sayeedbots_official");$("#telegramDownloaderBtn").onclick=()=>openSafe(cfg.telegramUrl||"https://t.me/sayeedbots_official");
    $("#supportedSitesBtn").onclick=()=>showView("downloaders");$("#supportedSitesBtn2").onclick=()=>showView("downloaders");
    $("#editFavoritesBtn").onclick=()=>toast("Favorite site editing is available through Admin configuration in this build.");
    $("#clearDownloadsBtn").onclick=()=>{if(confirm("Clear all download tasks?")){state.downloads=[];save()}};
    $$("[data-close-modal]").forEach(btn=>btn.onclick=()=>modal("#"+btn.dataset.closeModal,false));
    $$("#downloadTabs button").forEach(b=>b.onclick=()=>{$$("#downloadTabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeDownloadTab=b.dataset.downloadTab;renderDownloads()});
    $$("#videoTabs button").forEach(b=>b.onclick=()=>{$$("#videoTabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeVideoTab=b.dataset.videoTab;renderVideos()});
    $("#clearHistoryBtn").onclick=()=>{if(confirm("Clear link history?")){state.history=[];save()}};
    $("#addBookmarkBtn").onclick=addBookmark;
    $("#newTabBtn").onclick=()=>{addTab(prompt("Enter URL","https://www.google.com")||"");toast("New tab added.")};
    $("#clearWatchedBtn").onclick=()=>{if(confirm("Clear watched history?")){state.watched=[];save()}};
    $("#clearTabsBtn").onclick=()=>{if(confirm("Clear all tabs?")){state.tabs=[];save()}};
    $("#clearCacheBtn").onclick=()=>{Object.keys(localStorage).filter(k=>k.startsWith("pro_downloader")).forEach(k=>localStorage.removeItem(k));location.reload()};
    $("#deleteAccountBtn").onclick=deleteAccount;
    $("#logoutBtn").onclick=async()=>{try{await window.__firebaseAuth?.signOut()}catch{} state.user=null;save();showView("home");toast("Logged out.")};
    $("#authPrimaryBtn").onclick=handleAuthSubmit;
    $("#authModeBtn").onclick=()=>openAuth(authMode==="signin"?"signup":"signin");
    $("#forgotPasswordBtn").onclick=handleForgotPassword;
    $("#privacyBtn").onclick=()=>window.open("/privacy.html","_blank","noopener,noreferrer");$("#termsBtn").onclick=()=>window.open("/terms.html","_blank","noopener,noreferrer");
    $("#themeSelect").onchange=e=>{state.theme=e.target.value;save()};
    $("#qualitySelect").onchange=e=>{state.settings.quality=e.target.value;save()};
    $("#preferAudioToggle").onchange=e=>{state.settings.preferAudio=e.target.checked;save()};
    $("#askDownloadToggle").onchange=e=>{state.settings.askDownload=e.target.checked;save()};
    $("#saveHistoryToggle").onchange=e=>{state.settings.saveHistory=e.target.checked;save()};
    $("#notificationsToggle").onchange=e=>{state.settings.notifications=e.target.checked;save()};
    $("#continuePremiumBtn").onclick=()=>toast("Payment provider setup is required. Premium state is never trusted from the client.");
    $("#restorePurchaseBtn").onclick=()=>toast("Restore purchase requires a configured payment provider.");
    document.addEventListener("click",e=>{
      const el=e.target.closest("[data-play-url],[data-open-download],[data-delete-download],[data-delete-watched],[data-toggle-fav],[data-open-tab],[data-delete-tab],[data-reprocess-history],[data-delete-history],[data-open-bookmark],[data-delete-bookmark],[data-favorite-url],[data-open-bookmark],[data-audio-url],[data-tool]");
      if(!el) return;
      if(el.dataset.tool) return showTool(el.dataset.tool);
      if(el.dataset.playUrl) return openSafe(el.dataset.playUrl);
      if(el.dataset.openDownload) return openSafe(el.dataset.openDownload);
      if(el.dataset.deleteDownload){state.downloads=state.downloads.filter(x=>x.id!==el.dataset.deleteDownload);save();}
      if(el.dataset.deleteWatched){state.watched=state.watched.filter(x=>x.id!==el.dataset.deleteWatched);save();}
      if(el.dataset.toggleFav){const v=state.watched.find(x=>x.id===el.dataset.toggleFav);if(v){v.favorite=!v.favorite;save();}}
      if(el.dataset.openTab){const t=state.tabs.find(x=>x.id===el.dataset.openTab);if(t)openSafe(t.url)}
      if(el.dataset.deleteTab){state.tabs=state.tabs.filter(x=>x.id!==el.dataset.deleteTab);save();}
      if(el.dataset.reprocessHistory){const h=state.history.find(x=>x.id===el.dataset.reprocessHistory);if(h){showView("downloaders");$("#downloadUrlInput").value=h.url;resolveMedia(h.url)}}
      if(el.dataset.deleteHistory){state.history=state.history.filter(x=>x.id!==el.dataset.deleteHistory);save();}
      if(el.dataset.openBookmark){const b=state.bookmarks.find(x=>x.id===el.dataset.openBookmark);if(b)openSafe(b.url)}
      if(el.dataset.deleteBookmark){state.bookmarks=state.bookmarks.filter(x=>x.id!==el.dataset.deleteBookmark);save();}
      if(el.dataset.favoriteUrl) resolveMedia(el.dataset.favoriteUrl);
      if(el.dataset.audioUrl && el.dataset.audioUrl) openSafe(el.dataset.audioUrl);
    });
  }

  window.addEventListener("online",()=>$("#offlineBanner").classList.add("hidden"));
  window.addEventListener("offline",()=>$("#offlineBanner").classList.remove("hidden"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>state.theme==="system"&&applyTheme());

  if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
  bind(); applyTheme(); renderAll(); initFirebase().then(loadPublicFirebase);
})();
