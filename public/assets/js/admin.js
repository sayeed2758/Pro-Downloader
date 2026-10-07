(() => {
"use strict";
const cfg=window.PRO_DOWNLOADER_CONFIG||{};
let auth=null,db=null,currentUser=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const placeholder=()=>alert("Firebase is not configured. Add real Firebase client configuration before using the Admin console.");
const showModal=(html)=>{ $("#modalBody").innerHTML=html; $("#modal").classList.remove("hidden"); };
const hideModal=()=>$("#modal").classList.add("hidden");
function firebaseReady(){return cfg.firebase && cfg.firebase.apiKey && !String(cfg.firebase.apiKey).startsWith("YOUR_") && window.firebase;}
async function isAuthorized(uid){try{const snap=await db.ref("admins/"+uid).once("value");return snap.val()===true||typeof snap.val()==="object" && !!snap.val();}catch{return false}}
async function init(){
 if(!firebaseReady()){ $("#authMsg").textContent="Firebase configuration is still using placeholders."; return; }
 try{
  firebase.initializeApp(cfg.firebase); auth=firebase.auth(); db=firebase.database();
  auth.onAuthStateChanged(async user=>{
   currentUser=user;
   if(!user){$("#authGate").classList.remove("hidden");$("#dashboard").classList.add("hidden");return;}
   const ok=await isAuthorized(user.uid);
   if(!ok){$("#authMsg").textContent="This account is not authorized as an admin.";await auth.signOut();return;}
   $("#authGate").classList.add("hidden");$("#dashboard").classList.remove("hidden");await refreshAll();
  });
 }catch(e){$("#authMsg").textContent="Firebase initialization failed: "+e.message}
}
async function read(path, fallback={}){const s=await db.ref(path).once("value");return s.val()||fallback}
async function refreshAll(){await Promise.all([renderOverview(),renderSites(),renderPlans(),renderAnnouncements(),loadSettings(),renderReports()])}
function showSection(name){$$(".admin-section").forEach(s=>s.classList.remove("active"));$("#section-"+name).classList.add("active");$$(".side-link").forEach(b=>b.classList.toggle("active",b.dataset.section===name))}
async function renderOverview(){
 const users=await read("users",{}), sites=await read("supportedSites",{}), history=await read("downloadHistory",{});
 const arr=Object.values(users||{}); $("#totalUsers").textContent=arr.length; $("#premiumUsers").textContent=arr.filter(u=>u?.premium?.isPremium).length; $("#supportedCount").textContent=Object.values(sites||{}).filter(s=>s?.enabled).length; $("#linksProcessed").textContent=Object.values(history||{}).reduce((n,x)=>n+(x?Object.keys(x).length:0),0);
}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`}
async function renderSites(){
 const obj=await read("supportedSites",{}), entries=Object.entries(obj);
 $("#sitesTable").innerHTML=entries.length?table(["Name","Domain","Enabled","Actions"],entries.map(([id,s])=>`<tr><td>${esc(s.name)}</td><td>${esc(s.domain)}</td><td>${s.enabled?"Yes":"No"}</td><td><button class="action-btn" data-edit-site="${id}">Edit</button> <button class="action-btn danger" data-del-site="${id}">Delete</button></td></tr>`)):`<div class="card">No sites configured.</div>`;
}
async function renderPlans(){
 const obj=await read("premiumPlans",{}), entries=Object.entries(obj);
 $("#plansTable").innerHTML=entries.length?table(["Name","Duration","Price","Enabled","Actions"],entries.map(([id,p])=>`<tr><td>${esc(p.name)}</td><td>${esc(p.duration)}</td><td>${esc(p.price)}</td><td>${p.enabled?"Yes":"No"}</td><td><button class="action-btn" data-edit-plan="${id}">Edit</button> <button class="action-btn danger" data-del-plan="${id}">Delete</button></td></tr>`)): `<div class="card">No plans configured.</div>`;
}
async function renderAnnouncements(){
 const obj=await read("announcements",{}), entries=Object.entries(obj);
 $("#announcementsTable").innerHTML=entries.length?table(["Title","Type","Enabled","Actions"],entries.map(([id,a])=>`<tr><td>${esc(a.title)}</td><td>${esc(a.type)}</td><td>${a.enabled?"Yes":"No"}</td><td><button class="action-btn" data-edit-ann="${id}">Edit</button> <button class="action-btn danger" data-del-ann="${id}">Delete</button></td></tr>`)): `<div class="card">No announcements.</div>`;
}
async function loadSettings(){
 const s=await read("settings/public",{appName:"Pro Downloader",telegramUrl:"https://t.me/sayeedbots_official",watermark:"Made With ♥ By Shahid",supportEmail:"",latestVersion:"1.0.0",minimumVersion:"1.0.0",updateUrl:"",premiumBannerUrl:"",maintenanceMode:false});
 $("#setAppName").value=s.appName||"";$("#setTelegram").value=s.telegramUrl||"";$("#setWatermark").value=s.watermark||"";$("#setSupport").value=s.supportEmail||"";$("#setLatestVersion").value=s.latestVersion||"";$("#setMinimumVersion").value=s.minimumVersion||"";$("#setUpdateUrl").value=s.updateUrl||"";$("#setBannerUrl").value=s.premiumBannerUrl||"";$("#setMaintenance").checked=!!s.maintenanceMode;
}
async function renderReports(){const obj=await read("reports",{}), e=Object.entries(obj);$("#reportsList").innerHTML=e.length?e.slice(-40).reverse().map(([id,r])=>`<div class="list-item"><strong>${esc(r.issueType||"Issue")}</strong><div>${esc(r.description||"")}</div><small>${r.createdAt?new Date(r.createdAt).toLocaleString():""}</small></div>`).join(""):`<div class="card">No reports.</div>`}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function editSite(id,data){showModal(`<h2>${id?"Edit":"Add"} Supported Site</h2><label>Name<input id="mName" value="${esc(data?.name||"")}"></label><label>Domain<input id="mDomain" value="${esc(data?.domain||"")}"></label><label>Icon URL<input id="mIcon" value="${esc(data?.iconUrl||"")}"></label><label>Sort Order<input id="mSort" type="number" value="${Number(data?.sortOrder||0)}"></label><label><input id="mEnabled" type="checkbox" ${data?.enabled===false?"":"checked"}> Enabled</label><label><input id="mVideo" type="checkbox" ${data?.supportsVideo===false?"":"checked"}> Video</label><label><input id="mAudio" type="checkbox" ${data?.supportsAudio?"checked":""}> Audio</label><button class="primary" id="saveSite">Save</button>`);$("#saveSite").onclick=async()=>{const key=id||crypto.randomUUID();await db.ref("supportedSites/"+key).set({name:$("#mName").value.trim(),domain:$("#mDomain").value.trim().replace(/^www\\./,""),iconUrl:$("#mIcon").value.trim(),sortOrder:Number($("#mSort").value||0),enabled:$("#mEnabled").checked,supportsVideo:$("#mVideo").checked,supportsAudio:$("#mAudio").checked});hideModal();renderSites();renderOverview()}
function editPlan(id,data){showModal(`<h2>${id?"Edit":"Add"} Premium Plan</h2><label>Name<input id="pName" value="${esc(data?.name||"")}"></label><label>Duration<input id="pDuration" value="${esc(data?.duration||"")}"></label><label>Price<input id="pPrice" value="${esc(data?.price||"")}"></label><label>Original Price<input id="pOriginal" value="${esc(data?.originalPrice||"")}"></label><label>Discount Label<input id="pDiscount" value="${esc(data?.discountLabel||"")}"></label><label>Description<textarea id="pDesc">${esc(data?.description||"")}</textarea></label><label><input id="pEnabled" type="checkbox" ${data?.enabled===false?"":"checked"}> Enabled</label><button class="primary" id="savePlan">Save</button>`);$("#savePlan").onclick=async()=>{const key=id||crypto.randomUUID();await db.ref("premiumPlans/"+key).set({id:key,name:$("#pName").value.trim(),duration:$("#pDuration").value.trim(),price:$("#pPrice").value.trim(),originalPrice:$("#pOriginal").value.trim(),discountLabel:$("#pDiscount").value.trim(),description:$("#pDesc").value.trim(),enabled:$("#pEnabled").checked,sortOrder:data?.sortOrder||0});hideModal();renderPlans();}
}
function editAnn(id,data){showModal(`<h2>${id?"Edit":"New"} Announcement</h2><label>Title<input id="aTitle" value="${esc(data?.title||"")}"></label><label>Message<textarea id="aMsg">${esc(data?.message||"")}</textarea></label><label>Type<select id="aType"><option ${data?.type==="banner"?"selected":""}>banner</option><option ${data?.type==="modal"?"selected":""}>modal</option><option ${data?.type==="info"?"selected":""}>info</option></select></label><label>Start Date<input id="aStart" type="datetime-local" value="${esc(data?.startDate||"")}"></label><label>End Date<input id="aEnd" type="datetime-local" value="${esc(data?.endDate||"")}"></label><label><input id="aEnabled" type="checkbox" ${data?.enabled===false?"":"checked"}> Enabled</label><button class="primary" id="saveAnn">Save</button>`);$("#saveAnn").onclick=async()=>{const key=id||crypto.randomUUID();await db.ref("announcements/"+key).set({title:$("#aTitle").value.trim(),message:$("#aMsg").value.trim(),type:$("#aType").value,startDate:$("#aStart").value,endDate:$("#aEnd").value,enabled:$("#aEnabled").checked,updatedAt:firebase.database.ServerValue.TIMESTAMP});hideModal();renderAnnouncements()}}
$$(".side-link").forEach(b=>b.onclick=()=>showSection(b.dataset.section));
$("#closeModal").onclick=hideModal;$("#refreshBtn").onclick=refreshAll;
$("#loginBtn").onclick=async()=>{if(!firebaseReady())return placeholder();$("#authMsg").textContent="Signing in…";try{await auth.signInWithEmailAndPassword($("#emailInput").value,$("#passwordInput").value)}catch(e){$("#authMsg").textContent=e.message}};
$("#logoutBtn").onclick=()=>auth?.signOut();
$("#addSiteBtn").onclick=()=>editSite(null,{enabled:true,supportsVideo:true,supportsAudio:false});$("#addPlanBtn").onclick=()=>editPlan(null,{enabled:true});$("#addAnnouncementBtn").onclick=()=>editAnn(null,{enabled:true,type:"banner"});
$("#saveSettingsBtn").onclick=async()=>{await db.ref("settings/public").update({appName:$("#setAppName").value,telegramUrl:$("#setTelegram").value,watermark:$("#setWatermark").value,supportEmail:$("#setSupport").value,latestVersion:$("#setLatestVersion").value,minimumVersion:$("#setMinimumVersion").value,updateUrl:$("#setUpdateUrl").value,premiumBannerUrl:$("#setBannerUrl").value,maintenanceMode:$("#setMaintenance").checked,updatedAt:firebase.database.ServerValue.TIMESTAMP});alert("Settings saved.");};
document.addEventListener("click",async e=>{
 const t=e.target;
 if(t.dataset.editSite){const d=await read("supportedSites/"+t.dataset.editSite,{});editSite(t.dataset.editSite,d)}
 if(t.dataset.delSite&&confirm("Delete this supported site?")){await db.ref("supportedSites/"+t.dataset.delSite).remove();refreshAll()}
 if(t.dataset.editPlan){const d=await read("premiumPlans/"+t.dataset.editPlan,{});editPlan(t.dataset.editPlan,d)}
 if(t.dataset.delPlan&&confirm("Delete this plan?")){await db.ref("premiumPlans/"+t.dataset.delPlan).remove();refreshAll()}
 if(t.dataset.editAnn){const d=await read("announcements/"+t.dataset.editAnn,{});editAnn(t.dataset.editAnn,d)}
 if(t.dataset.delAnn&&confirm("Delete this announcement?")){await db.ref("announcements/"+t.dataset.delAnn).remove();refreshAll()}
});
init();
})();
