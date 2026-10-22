import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {getAuth,signInWithEmailAndPassword,signOut,onAuthStateChanged,createUserWithEmailAndPassword} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {getFirestore,doc,getDoc,setDoc,updateDoc,collection,getDocs,query,where,addDoc,deleteDoc} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {firebaseConfig,DOMAIN} from "./firebase-config.js";

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb), db = getFirestore(fb);
const $ = s => document.querySelector(s);
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const money = n => (Math.round(n * 100) / 100).toLocaleString("ar-EG");
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const tm = t => { const [h, m] = t.split(":"); return +h * 60 + +m; };
const nowT = () => new Date().toTimeString().slice(0, 5);
const email = u => u.includes("@") ? u.trim().toLowerCase() : `${u.trim().toLowerCase()}@${DOMAIN}`;
const TYPE = {daily: "باليومية", monthly: "بالشهر"};
const ST = {present: "حاضر", absent: "غائب", leave: "إجازة"};
const KIND = {deduction: "خصم", bonus: "مكافأة", advance: "سلفة", paid: "صرف من المرتب"};
let me = null, emps = [], tab = "home", S = {start: "09:00", end: "18:00"};
let editUid = null;
const shours = () => (tm(S.end) - tm(S.start)) / 60;

// ---------- حساب المرتب ----------
function calc(e, atts, adjs) {
  const present = atts.filter(a => a.status === "present").length;
  const absent = atts.filter(a => a.status === "absent").length;
  const ot = atts.reduce((s, a) => s + (+a.ot || 0), 0);
  const daily = e.type === "daily";
  const base = daily ? present * e.rate : e.rate;
  const absentDed = daily ? 0 : (e.rate / 30) * absent;
  const hourly = (daily ? e.rate : e.rate / 30) / shours();
  // أول ساعة تأخير بدون خصم، ومن الساعة الثانية يُخصم ساعة عن كل ساعة تأخير
  const lateH = atts.reduce((t, a) => { const l = a.in ? tm(a.in) - tm(S.start) : 0; return t + (l > 60 ? Math.ceil((l - 60) / 60) : 0); }, 0);
  const lateDed = lateH * hourly;
  const otRate = e.otRate || hourly * 1.5;
  const otPay = ot * otRate;
  const ded = adjs.filter(a => a.kind === "deduction").reduce((s, a) => s + a.amount, 0);
  const bonus = adjs.filter(a => a.kind === "bonus").reduce((s, a) => s + a.amount, 0);
  const adv = adjs.filter(a => a.kind === "advance" || a.kind === "paid").reduce((s, a) => s + a.amount, 0);
  return {present, absent, ot, base, absentDed, otPay, ded, bonus, adv, lateH, lateDed, net: base - absentDed - lateDed + otPay + bonus - ded - adv};
}

// ---------- الدخول ----------
function loginView(msg = "") {
  app.innerHTML = `<div class="login"><form class="card" id="lf"><h3>تسجيل الدخول</h3>
    <label>اسم المستخدم<input id="u" required autocomplete="username"></label>
    <label>كلمة المرور<input id="p" type="password" required autocomplete="current-password"></label>
    <div class="neg">${esc(msg)}</div><button class="btn pri">دخول</button></form></div>`;
  $("#lf").onsubmit = async ev => {
    ev.preventDefault();
    try { await signInWithEmailAndPassword(auth, email($("#u").value), $("#p").value); }
    catch (e) { loginView("بيانات الدخول غير صحيحة (" + (e.code || e.message) + ")"); }
  };
}

onAuthStateChanged(auth, async u => {
  if (!u) return loginView();
  let s;
  try { s = await getDoc(doc(db, "users", u.uid)); }
  catch (e) { await signOut(auth); return loginView("خطأ في قراءة البيانات: " + (e.code || e.message)); }
  if (!s.exists() || s.data().active === false) {
    const msg = s.exists() ? "الحساب موقوف (active = false)" : "مفيش document في collection اسمها users بالـ ID ده: " + u.uid;
    await signOut(auth); return loginView(msg);
  }
  me = {uid: u.uid, ...s.data()};
  const st = await getDoc(doc(db, "settings", "main")); if (st.exists()) S = st.data();
  me.role === "admin" ? adminView() : empView();
});

const shell = (body, nav = "") => {
  app.innerHTML = `<header><b>👤 ${esc(me.name)}</b><button class="btn" id="out">خروج</button></header>
  <div class="wrap">${nav}<div id="main">${body}</div></div>`;
  $("#out").onclick = () => signOut(auth);
};

// ---------- الأدمن ----------
async function loadEmps() {
  const s = await getDocs(collection(db, "users"));
  emps = s.docs.map(d => ({uid: d.id, ...d.data()})).filter(e => e.role !== "admin");
}
async function adminView() {
  await loadEmps();
  const tabs = {home: "الرئيسية", emps: "الموظفين", att: "الحضور والغياب", pay: "المرتبات والخصومات"};
  shell("", `<nav>${Object.entries(tabs).map(([k, v]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${v}</button>`).join("")}</nav>`);
  document.querySelectorAll("nav button").forEach(b => b.onclick = () => { tab = b.dataset.t; adminView(); });
  ({home: homeTab, emps: empsTab, att: attTab, pay: payTab})[tab]();
}

async function homeTab() {
  $("#main").innerHTML = `<div class="card"><label style="max-width:200px">الشهر<input type="month" id="m" value="${today().slice(0, 7)}"></label></div><div id="rep"></div>`;
  const load = async () => {
    const m = $("#m").value;
    const [as, js] = await Promise.all([getDocs(query(collection(db, "attendance"), where("month", "==", m))), getDocs(query(collection(db, "adjustments"), where("month", "==", m)))]);
    const atts = as.docs.map(d => d.data()), adjs = js.docs.map(d => d.data());
    const T = {base: 0, bonus: 0, adv: 0, ot: 0, ded: 0, net: 0};
    emps.forEach(e => { const c = calc(e, atts.filter(a => a.uid === e.uid), adjs.filter(a => a.uid === e.uid));
      T.base += c.base; T.bonus += c.bonus; T.adv += c.adv; T.ot += c.otPay; T.ded += c.ded + c.absentDed + c.lateDed; T.net += c.net; });
    const sm = t => `<br><small style="color:var(--mut)">${t}</small>`;
    $("#rep").innerHTML = `<div class="stats">
      <div class="stat"><b>${money(T.base + T.bonus)}</b>إجمالي المرتبات${sm(`يوميات / مرتبات ${money(T.base)} + مكافآت ${money(T.bonus)}`)}</div>
      <div class="stat"><b class="neg">${money(T.adv)}</b>إجمالي السلف${sm("شامل المرتب المصروف مقدماً")}</div>
      <div class="stat"><b>${money(T.bonus)}</b>إجمالي المكافآت</div>
      <div class="stat"><b class="${T.net < 0 ? "neg" : "net"}">${money(T.net)}</b>صافي المستحق${sm("بعد الإضافي والخصومات والسلف")}</div></div>
      <div class="card" style="margin-top:12px"><small style="color:var(--mut)">إجمالي الإضافي ${money(T.ot)} — إجمالي الخصومات (غياب وتأخير وخصومات) ${money(T.ded)} — عدد الموظفين ${emps.length}</small></div>`;
  };
  $("#m").onchange = load; load();
}

function editCard() {
  const e = emps.find(x => x.uid === editUid); if (!e) return "";
  return `<div class="card" style="border-color:var(--pri)"><h3>تعديل بيانات: ${esc(e.name)}</h3><form id="ef" class="grid">
    <label>الاسم<input id="en" required value="${esc(e.name)}"></label>
    <label>اسم المستخدم (لا يتغير)<input value="${esc(e.username)}" disabled></label>
    <label>نوع الموظف<select id="et"><option value="monthly" ${e.type === "monthly" ? "selected" : ""}>بالشهر</option><option value="daily" ${e.type === "daily" ? "selected" : ""}>باليومية</option></select></label>
    <label>الأجر (مرتب شهري أو يومية)<input id="er" type="number" min="0" step="any" required value="${e.rate}"></label>
    <label>سعر ساعة الإضافي (0 = تلقائي)<input id="eo" type="number" min="0" step="any" value="${e.otRate || 0}"></label>
    <button class="btn pri">حفظ التعديل</button><button type="button" class="btn" id="ec">إلغاء</button></form></div>`;
}

function empsTab() {
  $("#main").innerHTML = `${editCard()}<div class="card"><h3>مواعيد العمل</h3><div class="grid"><label>بداية الدوام<input type="time" id="s1" value="${S.start}"></label><label>نهاية الدوام<input type="time" id="s2" value="${S.end}"></label><button class="btn pri" id="ss">حفظ</button></div><small>أول ساعة تأخير بدون خصم، ومن الساعة الثانية يُخصم ساعة عن كل ساعة تأخير بسعر ساعة الموظف.</small></div><div class="card"><h3>إضافة موظف وإنشاء حساب</h3><form id="nf" class="grid">
    <label>الاسم<input id="n" required></label>
    <label>اسم المستخدم<input id="un" required pattern="[A-Za-z0-9._-]+" title="حروف إنجليزي وأرقام فقط"></label>
    <label>كلمة المرور<input id="pw" required minlength="6"></label>
    <label>نوع الموظف<select id="ty"><option value="monthly">بالشهر</option><option value="daily">باليومية</option></select></label>
    <label>الأجر (مرتب شهري أو يومية)<input id="rt" type="number" min="0" step="any" required></label>
    <label>سعر ساعة الإضافي (اختياري)<input id="ot" type="number" min="0" step="any"></label>
    <button class="btn pri">إنشاء</button></form><div id="msg" class="neg"></div></div>
    <div class="card tw"><table><tr><th>الاسم</th><th>المستخدم</th><th>النوع</th><th>الأجر</th><th>سعر الإضافي</th><th>الحالة</th><th></th></tr>
    ${emps.map(e => `<tr><td>${esc(e.name)}</td><td>${esc(e.username)}</td><td>${TYPE[e.type]}</td><td>${money(e.rate)}</td><td>${e.otRate ? money(e.otRate) : "تلقائي"}</td>
    <td>${e.active === false ? "موقوف" : "نشط"}</td><td><button class="btn" data-a="edit" data-id="${e.uid}">تعديل</button>
    <button class="btn" data-a="tog" data-id="${e.uid}">${e.active === false ? "تفعيل" : "إيقاف"}</button></td></tr>`).join("")}</table></div>`;
  $("#ss").onclick = async () => { S = {start: $("#s1").value, end: $("#s2").value}; await setDoc(doc(db, "settings", "main"), S); alert("تم الحفظ"); };
  if ($("#ef")) {
    $("#ec").onclick = () => { editUid = null; empsTab(); };
    $("#ef").onsubmit = async ev => { ev.preventDefault();
      await updateDoc(doc(db, "users", editUid), {name: $("#en").value.trim(), type: $("#et").value, rate: +$("#er").value, otRate: +$("#eo").value || 0});
      editUid = null; adminView(); };
  }
  $("#nf").onsubmit = async ev => {
    ev.preventDefault();
    const msg = $("#msg"); msg.textContent = "";
    try {
      // تطبيق ثانوي حتى لا يخرج الأدمن من حسابه
      const sec = initializeApp(firebaseConfig, "sec" + Date.now());
      const cred = await createUserWithEmailAndPassword(getAuth(sec), email($("#un").value), $("#pw").value);
      await setDoc(doc(db, "users", cred.user.uid), {
        name: $("#n").value, username: $("#un").value.trim().toLowerCase(), role: "employee", type: $("#ty").value,
        rate: +$("#rt").value, otRate: +$("#ot").value || 0, active: true});
      adminView();
    } catch (e) { msg.textContent = e.code === "auth/email-already-in-use" ? "اسم المستخدم موجود بالفعل" : e.message; }
  };
  $("#main").onclick = async ev => {
    const b = ev.target.closest("button[data-a]"); if (!b) return;
    const e = emps.find(x => x.uid === b.dataset.id);
    if (b.dataset.a === "tog") await updateDoc(doc(db, "users", e.uid), {active: e.active === false});
    else { editUid = e.uid; empsTab(); window.scrollTo(0, 0); return; }
    adminView();
  };
}

async function attTab() {
  $("#main").innerHTML = `<div class="card"><div class="grid"><label>اليوم<input type="date" id="d" value="${today()}"></label>
    <div>ميعاد الحضور: <b>${S.start}</b><br>الانصراف: <b>${S.end}</b> (${shours()} ساعات)</div>
    </div>
    <div class="grid" style="margin-top:10px"><button class="btn pri" id="sin">📥 تحضير</button><button class="btn pri" id="sout" style="background:#8250df;border-color:#8250df">📤 انصراف</button></div>
    <div id="sc" style="display:none;margin-top:10px"><div id="mode" style="font-weight:700;margin-bottom:6px"></div><video id="vd" playsinline muted style="width:100%;max-width:320px;border-radius:10px"></video><br><button class="btn pri" id="stop" style="margin-top:8px">✅ إنهاء</button></div>
    <div id="scmsg" style="margin:8px 0;font-weight:600"></div>
    <div class="grid"><label>تسجيل يدوي بالوقت الحالي<select id="pick">${emps.filter(e => e.active !== false).map(e => `<option value="${e.uid}">${esc(e.name)}</option>`).join("")}</select></label><div class="grid"><button class="btn" id="pin">تحضير</button><button class="btn" id="pout">انصراف</button></div></div>
    <div class="grid" style="margin-top:8px"><label class="btn" style="text-align:center;display:block">📸 صورة QR (تحضير)<input id="photoin" type="file" accept="image/*" capture="environment" hidden></label><label class="btn" style="text-align:center;display:block">📸 صورة QR (انصراف)<input id="photoout" type="file" accept="image/*" capture="environment" hidden></label></div>
    <small>اضغط تحضير أو انصراف، والكاميرا تفضل مفتوحة وتسجّل كل اللي تمسحهم، وبعدين دوس إنهاء. الإضافي بيتحسب تلقائي بعد ${S.end}.</small></div><div id="list"></div>`;
  const load = async () => {
    const d = $("#d").value;
    const s = await getDocs(query(collection(db, "attendance"), where("date", "==", d)));
    const map = {}; s.docs.forEach(x => map[x.data().uid] = x.data());
    $("#list").innerHTML = `<div class="card tw"><table><tr><th>الموظف</th><th>الحالة</th><th>حضور</th><th>انصراف</th><th>تأخير</th><th>ساعات إضافية</th></tr>
      ${emps.filter(e => e.active !== false).map(e => { const a = map[e.uid] || {}, l = a.in ? tm(a.in) - tm(S.start) : 0;
      return `<tr data-id="${e.uid}"><td>${esc(e.name)}</td><td><select class="st"><option value="">—</option>
      ${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
      <td><input class="in" type="time" value="${a.in || ""}"></td><td><input class="out" type="time" value="${a.out || ""}"></td>
      <td class="${l > 60 ? "neg" : ""}">${l > 0 ? l + " د" + (l > 60 ? " (خصم)" : "") : "—"}</td>
      <td><input class="ot" type="number" min="0" step="0.25" value="${a.ot || 0}" style="width:80px"></td></tr>`; }).join("")}</table>
      <small>التغييرات تُحفظ تلقائياً</small></div>`;
  };
  const log = m => $("#scmsg").insertAdjacentHTML("afterbegin", `<div>${esc(m)}</div>`);
  const stamp = async (uid, mode) => {
    const e = emps.find(x => x.uid === uid);
    if (!e || e.active === false) return "❌ كود غير معروف أو حساب موقوف";
    const d = today(), t = nowT(), ref = doc(db, "attendance", uid + "_" + d), sn = await getDoc(ref);
    const a = sn.exists() ? sn.data() : {uid, date: d, month: d.slice(0, 7), status: "present", ot: 0};
    let txt;
    if (mode === "in") {
      if (a.in) return `⚠️ ${e.name}: اتحضّر قبل كده الساعة ${a.in}`;
      a.in = t; a.status = "present"; const l = tm(t) - tm(S.start);
      txt = `${e.name}: حضور ${t}` + (l > 60 ? ` — متأخر ${l} د (خصم ${Math.ceil((l - 60) / 60)} ساعة)` : l > 0 ? ` — متأخر ${l} د (ضمن السماح)` : "");
    } else {
      if (!a.in) return `⚠️ ${e.name}: لسه ما اتحضّرش النهارده`;
      if (a.out) return `⚠️ ${e.name}: سجّل انصراف قبل كده الساعة ${a.out}`;
      a.out = t; const o = tm(t) - tm(S.end); a.ot = o > 0 ? Math.floor(o / 15) / 4 : 0;
      txt = `${e.name}: انصراف ${t}` + (a.ot ? ` — إضافي ${a.ot} س` : "");
    }
    await setDoc(ref, a); if ($("#d").value === d) load();
    return "✅ " + txt;
  };
  let stream, raf;
  const stop = () => { cancelAnimationFrame(raf); stream && stream.getTracks().forEach(t => t.stop()); stream = null; $("#sc").style.display = "none"; };
  $("#stop").onclick = stop;
  const start = async mode => {
    if (stream) return;
    $("#scmsg").innerHTML = "";
    if (!window.jsQR) { log("مكتبة المسح لم تُحمّل — استخدم التسجيل اليدوي"); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}}); }
    catch { log("الكاميرا غير متاحة هنا — استخدم التسجيل اليدوي أو الصورة، أو افتح الصفحة في المتصفح مباشرة"); return; }
    $("#mode").textContent = mode === "in" ? "📥 وضع التحضير — قرّب الكود من الكاميرا" : "📤 وضع الانصراف — قرّب الكود من الكاميرا";
    const v = $("#vd"); v.srcObject = stream; await v.play(); $("#sc").style.display = "block";
    const cv = document.createElement("canvas"), cx = cv.getContext("2d", {willReadFrequently: true}), done = new Set(); let busy = false;
    const tick = async () => {
      if (!stream) return;
      if (v.videoWidth && !busy) { cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0);
        const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
        if (r && r.data.startsWith("HR:") && !done.has(r.data.slice(3))) {
          const uid = r.data.slice(3); done.add(uid); busy = true;
          try { log(await stamp(uid, mode)); } catch (err) { done.delete(uid); log("❌ خطأ: " + (err.code || err.message)); }
          busy = false;
        } }
      raf = requestAnimationFrame(tick);
    };
    tick();
  };
  $("#sin").onclick = () => start("in");
  $("#sout").onclick = () => start("out");
  $("#pin").onclick = async () => log(await stamp($("#pick").value, "in"));
  $("#pout").onclick = async () => log(await stamp($("#pick").value, "out"));
  const photo = mode => ev => {
    const f = ev.target.files[0]; if (!f) return;
    if (!window.jsQR) { log("مكتبة المسح لم تُحمّل — استخدم التسجيل اليدوي"); return; }
    const img = new Image();
    img.onload = async () => {
      const sc = Math.min(1, 1000 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
      cv.width = img.width * sc; cv.height = img.height * sc;
      const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0, cv.width, cv.height);
      const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
      if (r && r.data.startsWith("HR:")) log(await stamp(r.data.slice(3), mode)); else log("❌ ما قدرتش أقرأ الـ QR — قرّب الصورة وخليه واضح");
      ev.target.value = "";
    };
    img.src = URL.createObjectURL(f);
  };
  $("#photoin").onchange = photo("in");
  $("#photoout").onchange = photo("out");
  $("#d").onchange = load; await load();
  $("#main").onchange = async ev => {
    const tr = ev.target.closest("tr[data-id]"); if (!tr) return;
    const d = $("#d").value, uid = tr.dataset.id, status = tr.querySelector(".st").value, ot = +tr.querySelector(".ot").value || 0;
    const ref = doc(db, "attendance", uid + "_" + d);
    status ? await setDoc(ref, {uid, date: d, month: d.slice(0, 7), status, ot, in: tr.querySelector(".in").value, out: tr.querySelector(".out").value}) : await deleteDoc(ref);
    load();
  };
}

async function payTab() {
  const m0 = today().slice(0, 7);
  $("#main").innerHTML = `<div class="card"><label style="max-width:200px">الشهر<input type="month" id="m" value="${m0}"></label></div><div id="rep"></div>`;
  const load = async () => {
    const m = $("#m").value;
    const [as, js] = await Promise.all([getDocs(query(collection(db, "attendance"), where("month", "==", m))), getDocs(query(collection(db, "adjustments"), where("month", "==", m)))]);
    const atts = as.docs.map(d => d.data()), adjs = js.docs.map(d => ({id: d.id, ...d.data()}));
    let total = 0;
    const rows = emps.map(e => { const c = calc(e, atts.filter(a => a.uid === e.uid), adjs.filter(a => a.uid === e.uid)); total += c.net;
      return `<tr><td>${esc(e.name)}</td><td>${TYPE[e.type]}</td><td>${c.present}</td><td>${c.absent}</td><td>${c.ot}</td><td>${money(c.base)}</td>
      <td class="neg">${money(c.absentDed)}</td><td class="neg">${money(c.lateDed)}</td><td>${money(c.otPay)}</td><td>${money(c.bonus)}</td><td class="neg">${money(c.ded)}</td><td class="neg">${money(c.adv)}</td><td class="${c.net < 0 ? "neg" : "net"}"><b>${money(c.net)}</b></td></tr>`; }).join("");
    $("#rep").innerHTML = `<div class="card tw"><h3>كشف المرتبات</h3><table><tr><th>الموظف</th><th>النوع</th><th>حضور</th><th>غياب</th><th>س. إضافي</th><th>الأساسي</th><th>خصم غياب</th><th>خصم تأخير</th><th>قيمة الإضافي</th><th>مكافآت</th><th>خصومات</th><th>سلف / مسحوبات</th><th>الصافي</th></tr>${rows}
      <tr><td colspan="12"><b>الإجمالي</b></td><td class="net"><b>${money(total)}</b></td></tr></table></div>
      <div class="card"><h3>إضافة خصم / مكافأة / سلفة / صرف مرتب</h3><form id="af" class="grid"><label>الموظف<select id="ae">${emps.map(e => `<option value="${e.uid}">${esc(e.name)}</option>`).join("")}</select></label>
      <label>النوع<select id="ak"><option value="deduction">خصم</option><option value="bonus">مكافأة</option><option value="advance">سلفة</option><option value="paid">صرف من المرتب</option></select></label>
      <label>المبلغ<input id="aa" type="number" min="0" step="any" required></label><label>السبب<input id="ar"></label><button class="btn pri">إضافة</button></form></div>
      <div class="card tw"><table><tr><th>الموظف</th><th>النوع</th><th>المبلغ</th><th>السبب</th><th></th></tr>${adjs.map(a => `<tr><td>${esc((emps.find(e => e.uid === a.uid) || {}).name)}</td>
      <td>${KIND[a.kind] || a.kind}</td><td>${money(a.amount)}</td><td>${esc(a.reason)}</td><td><button class="btn bad" data-del="${a.id}">حذف</button></td></tr>`).join("")}</table></div>`;
    $("#af").onsubmit = async ev => { ev.preventDefault();
      await addDoc(collection(db, "adjustments"), {uid: $("#ae").value, month: m, kind: $("#ak").value, amount: +$("#aa").value, reason: $("#ar").value}); load(); };
    $("#rep").onclick = async ev => { const b = ev.target.closest("[data-del]"); if (b && confirm("حذف؟")) { await deleteDoc(doc(db, "adjustments", b.dataset.del)); load(); } };
  };
  $("#m").onchange = load; load();
}

// ---------- الموظف ----------
async function empView() {
  shell(`<div class="card" style="text-align:center"><h3>كود الحضور الخاص بك</h3><div id="qr" style="display:inline-block;background:#fff;padding:10px;border-radius:8px"></div><div style="margin-top:8px">ميعاد الحضور <b>${S.start}</b> — الانصراف <b>${S.end}</b></div></div><div class="card"><label style="max-width:200px">الشهر<input type="month" id="m" value="${today().slice(0, 7)}"></label></div><div id="rep"></div>`);
  if (window.QRCode) new QRCode($("#qr"), {text: "HR:" + me.uid, width: 180, height: 180}); else $("#qr").textContent = "HR:" + me.uid;
  const load = async () => {
    const m = $("#m").value;
    const [as, js] = await Promise.all([
      getDocs(query(collection(db, "attendance"), where("uid", "==", me.uid), where("month", "==", m))),
      getDocs(query(collection(db, "adjustments"), where("uid", "==", me.uid), where("month", "==", m)))]);
    const atts = as.docs.map(d => d.data()).sort((a, b) => a.date.localeCompare(b.date)), adjs = js.docs.map(d => d.data());
    const c = calc(me, atts, adjs);
    $("#rep").innerHTML = `<div class="card"><h3>ملخص الشهر (${TYPE[me.type]})</h3><div class="stats">
      <div class="stat"><b>${c.present}</b>حضور</div><div class="stat"><b>${c.absent}</b>غياب</div><div class="stat"><b>${c.ot}</b>ساعات إضافية</div>
      <div class="stat"><b>${money(c.base)}</b>الأساسي</div><div class="stat"><b>${money(c.otPay)}</b>الإضافي</div>
      <div class="stat"><b class="neg">${money(c.ded + c.absentDed + c.lateDed)}</b>إجمالي الخصومات</div><div class="stat"><b>${money(c.bonus)}</b>مكافآت</div><div class="stat"><b class="neg">${money(c.adv)}</b>سلف / مسحوبات</div>
      <div class="stat"><b class="net">${money(c.net)}</b>الصافي</div></div></div>
      <div class="card tw"><h3>الحضور</h3><table><tr><th>التاريخ</th><th>الحالة</th><th>حضور</th><th>انصراف</th><th>إضافي</th></tr>${atts.map(a => `<tr><td>${a.date}</td><td>${ST[a.status]}</td><td>${a.in || "—"}</td><td>${a.out || "—"}</td><td>${a.ot || 0}</td></tr>`).join("")}</table></div>
      <div class="card tw"><h3>الخصومات والمكافآت</h3><table><tr><th>النوع</th><th>المبلغ</th><th>السبب</th></tr>${adjs.map(a => `<tr><td>${KIND[a.kind] || a.kind}</td><td>${money(a.amount)}</td><td>${esc(a.reason)}</td></tr>`).join("")}</table></div>`;
  };
  $("#m").onchange = load; load();
}
