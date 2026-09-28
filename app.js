/*** ══════════ ตั้งค่า Firebase (แก้ตรงนี้ที่เดียว) ══════════ ***
 * คัดลอกค่า firebaseConfig จาก Firebase Console:
 * Project settings → General → Your apps → SDK setup and configuration
 ***/
const firebaseConfig = {
  apiKey: "ใส่ค่าจาก Firebase Console ตรงนี้",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxx"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
firebase.auth().signInAnonymously().catch(e => console.error('Firebase auth error:', e));

const TAP_NEED = 5;        // แตะกี่ครั้งเพื่อเปิดแก้ไข
const TAP_RESET_MS = 1600; // ถ้าหยุดแตะเกินเวลานี้ นับใหม่

/*** ══════════ STATE ══════════ ***/
const S = {
  user: null, day: null, meters: [],
  bizDate: '', viewDate: '', session: 'DAY',
  openId: null, openMode: 'NEW',   // NEW | EDIT | UNLOCK
  pending: {},   // meterId -> true  (กำลังส่งเบื้องหลัง)
  failed: {},    // meterId -> ข้อความ error
  queued: {},    // meterId -> true  (ออฟไลน์ รอส่ง)
  taps: {},      // meterId -> จำนวนครั้งที่แตะ
  tapTimer: {},
  reportData: null, reportBlob: null
};

let deferredPrompt = null;

const LS = {
  get s() { try { return JSON.parse(localStorage.getItem('wm_session') || 'null'); } catch (e) { return null; } },
  set s(v) { localStorage.setItem('wm_session', JSON.stringify(v)); },
  get q() { try { return JSON.parse(localStorage.getItem('wm_queue') || '[]'); } catch (e) { return []; } },
  set q(v) { localStorage.setItem('wm_queue', JSON.stringify(v)); }
};

const $ = id => document.getElementById(id);
const isAdmin = () => !!(S.user && S.user.role === 'ADMIN');
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

const fmt = (n, len) => (n === null || n === '' || n === undefined) ? '-' : String(n).padStart(len || 0, '0');
const pillOf = s => s === 'ALERT' ? 'red' : s === 'REVIEW' ? 'crit' : s === 'INITIAL' ? 'init' : 'green';
const nameOf = id => { const m = S.meters.find(x => x.meterId === id); return m ? m.meterName : id; };
const itemOf = id => S.day.items.find(x => x.meterId === id);

function busy(on) { $('loading').classList.toggle('hidden', !on); }

function msg(el, text, kind) {
  const e = $(el);
  if (!e) return;
  e.textContent = text;
  e.className = 'msg ' + (kind || 'info');
  if (text) setTimeout(() => { if (e.textContent === text) e.textContent = ''; }, 7000);
}

/*** ══════════ TOAST (แจ้งเตือนไม่บล็อกหน้าจอ) ══════════ ***/
let toastTimer = null;
function toast(text, kind) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast ' + (kind || 'ok');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

/*** ══════════ DATE/TIME (Asia/Bangkok) ══════════ ***/
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function nowStamp() {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
  return todayStr() + ' ' + t;
}
function bangkokHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(new Date()));
}
function addDaysStr(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}
/* รอบเที่ยงคืน: เปิดรับ 21:00 ของวัน N ถึง 05:00 ของวัน N+1 → คืนค่าวันที่ N ถ้าเปิดอยู่ ไม่งั้นคืน null */
function midnightBusinessDate() {
  const h = bangkokHour();
  if (h >= 21) return todayStr();
  if (h < 5) return addDaysStr(todayStr(), -1);
  return null;
}

/*** ══════════ API (Firestore ล้วน — ไม่มี GAS แล้ว) ══════════ ***/
async function api(action, payload) {
  const p = payload || {};
  switch (action) {
    case 'login':          return fbLogin(p);
    case 'bootstrap':      return fbBootstrap();
    case 'getDay':         return fbGetDay(p);
    case 'submitReadings': return fbSubmitReadings(p);
    case 'editReading':    return fbEditReading(p);
    case 'voidReading':    return fbVoidReading(p);
    case 'voidDay':        return fbVoidDay(p);
    case 'history':        return fbHistory(p);
    case 'saveMeter':      return fbSaveMeter(p);
    case 'listUsers':      return fbListUsers();
    case 'saveUser':       return fbSaveUser(p);
    case 'deleteUser':     return fbDeleteUser(p);
    case 'deleteMeterRow': return fbDeleteMeter(p);
    case 'clearCache':     return {};
    default: throw new Error('UNKNOWN_ACTION: ' + action);
  }
}

/*** ── AUTH ── */
async function fbFindUser(email) {
  const doc = await db.collection('users').doc(String(email || '').trim().toLowerCase()).get();
  return doc.exists ? doc.data() : null;
}

async function fbRequireUser(roles) {
  if (!S.user) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const u = await fbFindUser(S.user.email);
  if (!u || !u.active) throw new Error('ไม่มีสิทธิ์เข้าใช้งาน');
  if (String(u.pin) !== String(S.user.pin)) throw new Error('PIN ไม่ถูกต้อง');
  if (roles && roles.indexOf(u.role) === -1) throw new Error('บทบาทนี้ไม่มีสิทธิ์ทำรายการ');
  return { email: S.user.email, role: u.role, displayName: u.displayName, allowed: u.allowedMeters };
}

async function fbLogin(p) {
  const email = String(p.email || '').trim().toLowerCase();
  const doc = await db.collection('users').doc(email).get();
  if (!doc.exists) throw new Error('ไม่พบผู้ใช้งานนี้');
  const u = doc.data();
  if (!u.active) throw new Error('บัญชีนี้ถูกปิดใช้งาน');
  if (String(u.pin) !== String(p.pin).trim()) throw new Error('PIN ไม่ถูกต้อง');
  await fbAudit(email, 'LOGIN', 'USER', email, '', '');
  return { email: email, displayName: u.displayName, role: u.role, allowedMeters: u.allowedMeters || 'ALL' };
}

/*** ── METERS / SETTINGS ── */
async function fbGetMeters() {
  const snap = await db.collection('meters').where('active', '==', true).get();
  const rows = [];
  snap.forEach(d => {
    const m = d.data();
    rows.push({
      meterId: d.id, meterName: m.meterName, location: m.location || '',
      digitLength: Number(m.digitLength) || 7, inputDigits: Number(m.inputDigits) || 2,
      normalLimit: Number(m.normalLimit) || 0, hardLimit: Number(m.hardLimit) || 0,
      sortOrder: Number(m.sortOrder) || 999, midnightRound: !!m.midnightRound
    });
  });
  rows.sort((a, b) => a.sortOrder - b.sortOrder);
  return rows;
}

async function fbGetSettings() {
  const doc = await db.collection('settings').doc('config').get();
  return doc.exists ? doc.data() : {};
}

/*** ── BOOTSTRAP ── */
async function fbBootstrap() {
  const user = await fbRequireUser();
  const settings = await fbGetSettings();
  const meters = await fbGetMeters();
  return {
    appName: settings.appName || 'ระบบจดมิเตอร์น้ำ',
    businessDate: todayStr(), serverTime: nowStamp(),
    settings: settings, user: user, meters: meters
  };
}

/*** ── GET DAY ── */
async function fbLastReading(meterId) {
  const snap = await db.collection('readings')
    .where('meterId', '==', meterId).where('isVoid', '==', false)
    .orderBy('submittedAt', 'desc').limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0].data();
  return { businessDate: d.businessDate, fullReading: Number(d.fullReading) || 0 };
}

async function fbTodayReading(meterId, date, session) {
  const want = String(session || 'DAY').toUpperCase();
  const snap = await db.collection('readings')
    .where('meterId', '==', meterId).where('businessDate', '==', date).where('isVoid', '==', false)
    .orderBy('submittedAt', 'desc').limit(5).get();
  if (snap.empty) return null;
  const match = snap.docs.find(d => String(d.data().session || 'DAY').toUpperCase() === want);
  if (!match) return null;
  return Object.assign({ readingId: match.id }, match.data());
}

async function fbGetDay(p) {
  const user = await fbRequireUser();
  const session = String(p.session || 'DAY').toUpperCase();
  let meters = await fbGetMeters();
  if (session === 'MIDNIGHT') meters = meters.filter(m => m.midnightRound);
  const date = p.date || (session === 'MIDNIGHT' ? (midnightBusinessDate() || todayStr()) : todayStr());

  const items = await Promise.all(meters.map(async m => {
    const [last, cur] = await Promise.all([fbLastReading(m.meterId), fbTodayReading(m.meterId, date, session)]);
    const prevForToday = cur ? (Number(cur.previousReading) || 0) : (last ? Number(last.fullReading) : 0);
    return {
      meterId: m.meterId, meterName: m.meterName, location: m.location,
      digitLength: m.digitLength, inputDigits: m.inputDigits,
      normalLimit: m.normalLimit, hardLimit: m.hardLimit, sortOrder: m.sortOrder,
      hasBaseline: !!last, previousReading: prevForToday, previousDate: last ? last.businessDate : '',
      submitted: !!cur, readingId: cur ? cur.readingId : '',
      fullReading: cur ? Number(cur.fullReading) : null,
      inputValue: cur ? String(cur.inputValue) : '', entryType: cur ? String(cur.entryType) : '',
      usageUnits: cur ? Number(cur.usageUnits) : null, status: cur ? String(cur.status) : 'PENDING',
      submittedAt: cur ? String(cur.submittedAt) : '', submittedBy: cur ? String(cur.submittedBy) : '',
      remark: cur ? String(cur.remark || '') : ''
    };
  }));

  const done = items.filter(i => i.submitted).length;
  return {
    date: date, businessDate: todayStr(), session: session, isAdmin: user.role === 'ADMIN', items: items,
    midnightOpen: midnightBusinessDate() !== null,
    stats: {
      total: items.length, submitted: done, pending: items.length - done,
      alert: items.filter(i => i.status === 'ALERT' || i.status === 'REVIEW').length,
      totalUsage: items.reduce((s, i) => s + (i.usageUnits || 0), 0)
    }
  };
}

/*** ── SUBMIT ── */
async function fbSubmitReadings(p) {
  const user = await fbRequireUser(['ADMIN', 'RECORDER']);
  const isAdmin = user.role === 'ADMIN';
  const session = String(p.session || 'DAY').toUpperCase();
  const settings = await fbGetSettings();
  const allowSame = !!settings.allowSameReading;

  let date = p.date;
  if (session === 'MIDNIGHT') {
    const mbd = midnightBusinessDate();
    if (!isAdmin) {
      if (!mbd) throw new Error('ปิดรับข้อมูลรอบเที่ยงคืน (เปิดรับเวลา 21:00–05:00 น. เท่านั้น)');
      date = mbd;
    } else {
      date = date || mbd || todayStr();
    }
  } else {
    date = date || todayStr();
    if (!isAdmin && date !== todayStr()) throw new Error('บันทึกได้เฉพาะวันปัจจุบันเท่านั้น');
  }

  const entries = p.entries || [];
  if (!entries.length) throw new Error('ไม่มีข้อมูลที่จะบันทึก');

  let meters = await fbGetMeters();
  if (session === 'MIDNIGHT') meters = meters.filter(m => m.midnightRound);
  const metersMap = {}; meters.forEach(m => metersMap[m.meterId] = m);
  const results = [];

  for (const en of entries) {
    const mid = String(en.meterId).trim();
    const m = metersMap[mid];
    if (!m) { results.push({ meterId: mid, ok: false, error: session === 'MIDNIGHT' ? 'มิเตอร์นี้ไม่ได้เปิดใช้รอบเที่ยงคืน' : 'ไม่พบมิเตอร์' }); continue; }

    const rid = String(en.readingId || uuid());
    const existDoc = await db.collection('readings').doc(rid).get();
    if (existDoc.exists) { results.push({ meterId: mid, ok: true, duplicate: true }); continue; }

    const cur = await fbTodayReading(mid, date, session);
    if (cur && !(isAdmin && en.force)) {
      results.push({ meterId: mid, ok: false, locked: true, error: 'จุดนี้บันทึกไปแล้ว หากต้องการแก้ไข ให้แตะการ์ด 5 ครั้ง' });
      continue;
    }

    const last = await fbLastReading(mid);
    const prev = last ? Number(last.fullReading) : null;
    const digitLength = m.digitLength, inputDigits = m.inputDigits;
    const raw = String(en.value).replace(/\D/g, '');
    if (!raw) { results.push({ meterId: mid, ok: false, error: 'ยังไม่ได้กรอกตัวเลข' }); continue; }

    let entryType, full;
    if (prev === null || String(en.mode).toUpperCase() === 'FULL') {
      entryType = (prev === null) ? 'INITIAL' : 'FULL';
      if (raw.length > digitLength) { results.push({ meterId: mid, ok: false, error: 'เลขเกิน ' + digitLength + ' หลัก' }); continue; }
      full = Number(raw);
    } else {
      entryType = 'SUFFIX';
      if (raw.length > inputDigits) { results.push({ meterId: mid, ok: false, error: 'กรอกได้ไม่เกิน ' + inputDigits + ' หลัก' }); continue; }
      full = computeFull(prev, Number(raw), inputDigits, digitLength);
    }

    const base = (prev === null) ? full : prev;
    const usage = (entryType === 'INITIAL') ? 0 : calcUsage(base, full, digitLength);

    if (entryType === 'FULL' && full < base && !allowSame) {
      results.push({ meterId: mid, ok: false, error: 'เลขใหม่น้อยกว่าครั้งก่อน' }); continue;
    }

    let status = 'NORMAL';
    if (entryType === 'INITIAL') status = 'INITIAL';
    else if (m.hardLimit && usage > m.hardLimit) status = 'REVIEW';
    else if (m.normalLimit && usage > m.normalLimit) status = 'ALERT';

    if ((status === 'ALERT' || status === 'REVIEW') && !en.confirmed && settings.requireConfirmOverLimit) {
      results.push({ meterId: mid, ok: false, needConfirm: true, status: status, previewFull: full, previewUsage: usage,
        error: 'ใช้น้ำ ' + usage + ' หน่วย สูงกว่าเกณฑ์ กรุณายืนยัน' });
      continue;
    }

    await db.collection('readings').doc(rid).set({
      businessDate: date, meterId: mid, entryType: entryType, inputValue: raw,
      inputDigits: (entryType === 'SUFFIX') ? inputDigits : raw.length,
      previousReading: (prev === null) ? null : prev,
      fullReading: full, usageUnits: usage, status: status, session: session,
      submittedAt: nowStamp(), submittedBy: user.email,
      source: String(en.source || 'ONLINE'), isVoid: false, voidReason: '',
      remark: String(en.remark || '') + (cur ? ' [UNLOCK รอบเพิ่ม]' : '')
    });
    await fbAudit(user.email, 'CREATE_READING', 'READING', date, '', mid);
    results.push({ meterId: mid, ok: true, readingId: rid, entryType: entryType, fullReading: full, usageUnits: usage, status: status });
  }

  return { date: date, saved: results.filter(r => r.ok && !r.duplicate).length, results: results };
}

/*** ── EDIT / VOID ── */
async function fbEditReading(p) {
  const user = await fbRequireUser();
  const ref = db.collection('readings').doc(String(p.readingId));
  const doc = await ref.get();
  if (!doc.exists || doc.data().isVoid) throw new Error('ไม่พบรายการที่ต้องการแก้ไข');
  const target = doc.data();
  const meters = await fbGetMeters();
  const m = meters.find(x => x.meterId === target.meterId);
  if (!m) throw new Error('ไม่พบข้อมูลมิเตอร์');

  const raw = String(p.value).replace(/\D/g, '');
  if (!raw) throw new Error('กรุณากรอกตัวเลข');

  const oldFull = Number(target.fullReading) || 0;
  const prev = (target.previousReading === null || target.previousReading === undefined) ? null : Number(target.previousReading);
  const mode = String(p.mode || 'FULL').toUpperCase();
  let newFull;
  if (mode === 'FULL') {
    if (raw.length > m.digitLength) throw new Error('เลขเกิน ' + m.digitLength + ' หลัก');
    newFull = Number(raw);
  } else {
    if (raw.length > m.inputDigits) throw new Error('กรอกได้ไม่เกิน ' + m.inputDigits + ' หลัก');
    const baseP = Math.pow(10, m.inputDigits);
    newFull = Math.floor(oldFull / baseP) * baseP + Number(raw);
  }

  const usage = (target.entryType === 'INITIAL' || prev === null) ? 0 : (newFull - prev);
  let status = target.entryType === 'INITIAL' ? 'INITIAL' : 'NORMAL';
  if (status !== 'INITIAL') {
    if (usage < 0) status = 'REVIEW';
    else if (m.hardLimit && usage > m.hardLimit) status = 'REVIEW';
    else if (m.normalLimit && usage > m.normalLimit) status = 'ALERT';
  }

  const before = JSON.stringify({ input: target.inputValue, full: oldFull, usage: target.usageUnits });
  await ref.update({
    inputValue: raw, inputDigits: raw.length, fullReading: newFull, usageUnits: usage, status: status,
    remark: String(target.remark || '') + ' [EDIT ' + nowStamp() + ' โดย ' + user.email + ']'
  });
  await fbAudit(user.email, 'EDIT_READING', 'READING', p.readingId, before, JSON.stringify({ input: raw, full: newFull, usage: usage, status: status }));
  return { readingId: p.readingId, oldFull: oldFull, fullReading: newFull, usageUnits: usage, status: status, mode: mode };
}

async function fbVoidReading(p) {
  const user = await fbRequireUser(['ADMIN']);
  const ref = db.collection('readings').doc(String(p.readingId));
  const doc = await ref.get();
  if (!doc.exists) throw new Error('ไม่พบรายการนี้');
  await ref.update({ isVoid: true, voidReason: String(p.reason || '') + ' | โดย ' + user.email + ' | ' + nowStamp() });
  await fbAudit(user.email, 'VOID_READING', 'READING', p.readingId, '', String(p.reason || ''));
  return { readingId: p.readingId, voided: true };
}

async function fbVoidDay(p) {
  const user = await fbRequireUser(['ADMIN']);
  const date = p.date;
  if (!date) throw new Error('กรุณาระบุวันที่');
  if (String(p.confirmText || '').trim() !== 'ยืนยัน') throw new Error('ข้อความยืนยันไม่ถูกต้อง');
  const snap = await db.collection('readings').where('businessDate', '==', date).where('isVoid', '==', false).get();
  const reason = 'RESET ทั้งวัน โดย ' + user.email + ' | ' + nowStamp();
  const batch = db.batch();
  snap.forEach(d => batch.update(d.ref, { isVoid: true, voidReason: reason }));
  await batch.commit();
  await fbAudit(user.email, 'VOID_DAY', 'READING', date, '', 'cleared=' + snap.size);
  return { date: date, cleared: snap.size };
}

/*** ── HISTORY ── */
async function fbHistory(p) {
  await fbRequireUser();
  const mid = String(p.meterId || '').trim();
  const limit = Number(p.limit) || 100;
  let q = db.collection('readings').where('isVoid', '==', false);
  if (mid) q = q.where('meterId', '==', mid);
  const snap = await q.orderBy('submittedAt', 'desc').limit(limit).get();
  const meters = await fbGetMeters();
  const names = {}; meters.forEach(m => names[m.meterId] = m.meterName);
  const rows = snap.docs.map(d => {
    const r = d.data();
    return { date: r.businessDate, meterId: r.meterId, meterName: names[r.meterId] || '',
      entryType: r.entryType, fullReading: Number(r.fullReading), usageUnits: Number(r.usageUnits),
      status: r.status, submittedAt: r.submittedAt, submittedBy: r.submittedBy };
  });
  return { meterId: mid, rows: rows };
}

/*** ── METERS (admin) ── */
async function fbSaveMeter(p) {
  const user = await fbRequireUser(['ADMIN']);
  const mid = String(p.meterId).trim();
  const patch = p.patch || {};
  await db.collection('meters').doc(mid).set(patch, { merge: true });
  await fbAudit(user.email, 'SAVE_METER', 'METER', mid, '', JSON.stringify(patch));
  return { meterId: mid, saved: true };
}

async function fbDeleteMeter(p) {
  const user = await fbRequireUser(['ADMIN']);
  const mid = String(p.meterId).trim();
  await db.collection('meters').doc(mid).set({ active: false }, { merge: true });
  await fbAudit(user.email, 'DEACTIVATE_METER', 'METER', mid, '', '');
  return { meterId: mid, deactivated: true };
}

/*** ── USERS (admin) ── */
async function fbListUsers() {
  await fbRequireUser(['ADMIN']);
  const snap = await db.collection('users').get();
  const rows = snap.docs.map(d => {
    const u = d.data();
    return { email: d.id, displayName: u.displayName, pin: u.pin, role: u.role, active: u.active, allowedMeters: u.allowedMeters, note: u.note };
  });
  return { users: rows, total: rows.length };
}

async function fbSaveUser(p) {
  const admin = await fbRequireUser(['ADMIN']);
  const u = p.user || {};
  const email = String(u.email || '').trim().toLowerCase();
  if (!email || /\s/.test(email)) throw new Error('กรุณาตั้งชื่อผู้ใช้ (ห้ามเว้นวรรค)');
  if (!/^\d{4,8}$/.test(String(u.pin || ''))) throw new Error('PIN ต้องเป็นตัวเลข 4-8 หลัก');
  if (['ADMIN', 'RECORDER', 'VIEWER'].indexOf(String(u.role).toUpperCase()) < 0) throw new Error('บทบาทไม่ถูกต้อง');

  const active = u.active !== false;
  if (!active || String(u.role).toUpperCase() !== 'ADMIN') {
    const snap = await db.collection('users').where('role', '==', 'ADMIN').where('active', '==', true).get();
    const others = snap.docs.filter(d => d.id !== email);
    if (!others.length) throw new Error('ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 บัญชี');
  }

  const isNew = !(await db.collection('users').doc(email).get()).exists;
  await db.collection('users').doc(email).set({
    displayName: String(u.displayName || ''), pin: String(u.pin), role: String(u.role).toUpperCase(),
    active: active, allowedMeters: String(u.allowedMeters || 'ALL'), note: String(u.note || '')
  });
  await fbAudit(admin.email, isNew ? 'CREATE_USER' : 'UPDATE_USER', 'USER', email, '', JSON.stringify({ role: u.role, active: active }));
  return { email: email, saved: true, isNew: isNew };
}

async function fbDeleteUser(p) {
  const admin = await fbRequireUser(['ADMIN']);
  const email = String(p.targetEmail || '').trim().toLowerCase();
  if (email === String(admin.email).toLowerCase()) throw new Error('ลบบัญชีตัวเองไม่ได้');
  const doc = await db.collection('users').doc(email).get();
  if (!doc.exists) throw new Error('ไม่พบผู้ใช้นี้');
  const snap = await db.collection('users').where('role', '==', 'ADMIN').where('active', '==', true).get();
  const others = snap.docs.filter(d => d.id !== email);
  if (!others.length) throw new Error('ต้องมีผู้ดูแลระบบเหลืออย่างน้อย 1 บัญชี');
  await db.collection('users').doc(email).delete();
  await fbAudit(admin.email, 'DELETE_USER', 'USER', email, '', '');
  return { email: email, deleted: true };
}

/*** ── AUDIT LOG ── */
async function fbAudit(email, action, entityType, entityId, before, after) {
  try {
    await db.collection('audit_log').add({
      timestamp: nowStamp(), userEmail: email, action: action, entityType: entityType,
      entityId: entityId, beforeData: String(before).slice(0, 500), afterData: String(after).slice(0, 500)
    });
  } catch (e) {}
}

/*** ══════════ MATH ══════════ ***/
function computeFull(prev, suffix, digits, digitLength) {
  const base = Math.pow(10, digits), max = Math.pow(10, digitLength);
  let c = Math.floor(prev / base) * base + suffix;
  if (c < prev) c += base;
  if (c >= max) c -= max;
  return c;
}
function calcUsage(prev, full, digitLength) {
  return full >= prev ? full - prev : (Math.pow(10, digitLength) - prev) + full;
}

/*** ══════════ LOGIN (element ต่างๆ อาจไม่มีในบางหน้า เช่น meter.html — เช็คก่อนผูก event เสมอ) ══════════ ***/
if ($('btnLogin')) {
  $('btnLogin').onclick = async function () {
    const email = $('loginEmail').value.trim();
    const pin = $('loginPin').value.trim();
    if (!email || !pin) return msg('loginMsg', 'กรุณากรอกชื่อผู้ใช้และ PIN', 'err');
    busy(true);
    try {
      const u = await api('login', { email: email, pin: pin });
      S.user = Object.assign({}, u, { pin: pin });
      LS.s = S.user;
      await start();
    } catch (e) { msg('loginMsg', e.message, 'err'); }
    finally { busy(false); }
  };
}

if ($('loginPin')) {
  $('loginPin').addEventListener('keydown', e => { if (e.key === 'Enter' && $('btnLogin')) $('btnLogin').click(); });
}
if ($('btnTogglePin')) {
  $('btnTogglePin').onclick = function () {
    const inp = $('loginPin');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };
}
if ($('btnLogout')) {
  $('btnLogout').onclick = function () { localStorage.removeItem('wm_session'); location.reload(); };
}

/*** ══════════ START ══════════ ***/
async function start() {
  const boot = await api('bootstrap');
  S.meters = boot.meters;
  S.bizDate = boot.businessDate;
  S.viewDate = boot.businessDate;

  $('bizDate').textContent = boot.businessDate;
  $('userName').textContent = S.user.displayName + ' (' + S.user.role + ')';
  $('sumDate').value = boot.businessDate;
  $('entryDate').value = boot.businessDate;
  $('resetDate').value = boot.businessDate;
  $('hisMeter').innerHTML = '<option value="">ทุกจุด</option>' +
    S.meters.map(m => '<option value="' + m.meterId + '">' + m.meterName + '</option>').join('');

  if (isAdmin()) {
    $('tabAdminBtn').classList.remove('hidden');
    $('adminDateBox').classList.remove('hidden');
  }

  if ($('loginView')) $('loginView').classList.add('hidden');
  $('mainView').classList.remove('hidden');
  await loadDay(true);
  flushQueue();
}

/*** ══════════ LOAD DAY ══════════ ***/
async function loadDay(showSpinner) {
  if (showSpinner) busy(true);
  try {
    S.day = await api('getDay', { date: S.viewDate, session: S.session });
    S.viewDate = S.day.date;
    if (isAdmin()) $('entryDate').value = S.viewDate;
    S.openId = null;
    S.taps = {};
    renderMeters();
    refreshStats();
    renderMidnightStatus();
  } catch (e) { msg('entryMsg', e.message, 'err'); }
  finally { if (showSpinner) busy(false); }
}

function renderMidnightStatus() {
  const box = $('midnightStatus');
  if (S.session !== 'MIDNIGHT') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const open = S.day && S.day.midnightOpen;
  box.className = 'midnight-status ' + (open ? 'open' : 'closed');
  box.textContent = open
    ? '🌙 เปิดรับข้อมูลรอบเที่ยงคืน (ของวันที่ ' + S.viewDate + ') ถึง 05:00 น.'
    : '🌙 ปิดรับข้อมูลรอบเที่ยงคืนแล้ว — เปิดอีกครั้งเวลา 21:00 น.';
}

function switchSession(session) {
  S.session = session;
  $('btnSessionDay').classList.toggle('active', session === 'DAY');
  $('btnSessionMidnight').classList.toggle('active', session === 'MIDNIGHT');
  S.viewDate = session === 'MIDNIGHT' ? (midnightBusinessDate() || S.bizDate) : S.bizDate;
  if (isAdmin()) $('entryDate').value = S.viewDate;
  loadDay(true);
}
$('btnSessionDay').onclick = function () { switchSession('DAY'); };
$('btnSessionMidnight').onclick = function () { switchSession('MIDNIGHT'); };

function refreshStats() {
  const items = S.day ? S.day.items : [];
  const done = items.filter(i => i.submitted).length;
  $('stDone').textContent = done;
  $('stTotal').textContent = items.length;
  $('stPending').textContent = items.length - done;
  $('progFill').style.width = (items.length ? Math.round(done / items.length * 100) : 0) + '%';
}

$('btnRefresh').onclick = function () { loadDay(true); };
$('btnLoadEntryDate').onclick = function () {
  S.viewDate = $('entryDate').value || S.bizDate;
  loadDay(true);
};
$('btnTodayEntry').onclick = function () {
  S.viewDate = S.session === 'MIDNIGHT' ? (midnightBusinessDate() || S.bizDate) : S.bizDate;
  $('entryDate').value = S.viewDate;
  loadDay(true);
};

/*** ══════════ RENDER ══════════ ***/
function renderMeters() {
  const back = S.viewDate !== S.bizDate;
  let h = back ? '<div class="backdate">📅 กำลังดูวันที่ ' + S.viewDate + '</div>' : '';
  if (!S.day.items.length) {
    h += '<div class="tiphint">ยังไม่มีจุดที่เปิดใช้"รอบเที่ยงคืน" — ไปตั้งค่าที่ฟิลด์ <code>midnightRound</code> ของมิเตอร์ใน Firestore ก่อน</div>';
  } else {
    h += S.day.items.map((it, i) => cardHtml(it, i)).join('');
  }
  $('meterList').innerHTML = h;
  bindOpenCard();
}

function cardEl(id) { return document.querySelector('.mcard[data-mid="' + id + '"]'); }

/* วาดใหม่เฉพาะการ์ดเดียว ไม่กระทบการ์ดอื่นที่กำลังพิมพ์อยู่ */
function updateCard(id) {
  const el = cardEl(id);
  if (!el) return;
  const idx = S.day.items.findIndex(x => x.meterId === id);
  if (idx < 0) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(S.day.items[idx], idx);
  el.replaceWith(tmp.firstElementChild);
  if (S.openId === id) bindOpenCard();
}

function bindOpenCard() {
  const inp = document.querySelector('.mc-input');
  if (!inp) return;
  inp.addEventListener('input', onCardInput);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveCard(inp.dataset.id); });
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
  const chk = document.querySelector('.mc-full');
  if (chk) chk.addEventListener('change', onFullToggle);
}

function cardHtml(it, idx) {
  const id = it.meterId;
  const open = S.openId === id;
  const mode = open ? S.openMode : null;
  const saving = !!S.pending[id];
  const failed = S.failed[id];
  const queued = !!S.queued[id];

  let cls = 'mcard';
  if (open) cls += ' open';
  if (saving) cls += ' saving';
  else if (failed) cls += ' failed';
  else if (it.submitted) cls += ' saved';
  if (mode === 'EDIT') cls += ' m-edit';
  if (mode === 'UNLOCK') cls += ' m-unlock';

  /* ── ด้านขวาของหัวการ์ด ── */
  let right = '';
  if (saving) {
    right = '<span class="mc-dot"></span><span class="mc-tag save">กำลังบันทึก</span>';
  } else if (failed) {
    right = '<span class="mc-tag err">ไม่สำเร็จ</span>' +
            '<button class="mc-ab" data-act="retry" data-id="' + id + '">ลองใหม่</button>';
  } else if (it.submitted) {
    const left = TAP_NEED - (S.taps[id] || 0);
    right = '<span class="mc-val">' + fmt(it.fullReading, it.digitLength) + '</span>';
    if (queued) right += '<span class="mc-tag q">☁️ รอส่ง</span>';
    if (S.taps[id]) right += '<span class="mc-tap">แตะอีก ' + left + '</span>';
    if (isAdmin() && !open) {
      right += '<button class="mc-ab" data-act="unlock" data-id="' + id + '" title="บันทึกรอบเพิ่ม">🔓</button>';
    }
    if (open) right += '<button class="mc-ab" data-act="close" data-id="' + id + '">✕</button>';
  } else {
    right = '<span class="mc-tag wait">' + (it.hasBaseline ? 'รอบันทึก' : 'ตั้งต้น') + '</span>' +
            '<span class="mc-arrow">' + (open ? '▲' : '▼') + '</span>';
  }

  let html = '<div class="' + cls + '" data-mid="' + id + '">';
  html += '<div class="mc-head" data-act="head" data-id="' + id + '">' +
            '<span class="mc-no">' + (idx + 1) + '</span>' +
            '<div class="mc-title"><b>' + it.meterName + '</b>' +
              (it.location ? '<small>' + it.location + '</small>' : '') +
            '</div>' +
            '<div class="mc-right">' + right + '</div>' +
          '</div>';

  /* ── Dropdown ── */
  if (open) {
    const isInit = !it.hasBaseline;
    let hint = '', value = '', maxlen = it.inputDigits, btnText = 'บันทึก';

    if (mode === 'EDIT') {
      value = String(it.fullReading);
      maxlen = it.digitLength;
      hint = 'แก้ไขค่าที่บันทึกไว้ — ลบแล้วพิมพ์เลขเต็มใหม่ได้เลย<br>ครั้งก่อน <b>' + fmt(it.previousReading, it.digitLength) + '</b>';
      btnText = 'บันทึกแก้ไข';
    } else if (mode === 'UNLOCK') {
      hint = 'บันทึกรอบเพิ่ม — ฐาน <b>' + fmt(it.fullReading, it.digitLength) + '</b> หลักหน้ารันเพิ่มปกติ';
      btnText = 'บันทึกรอบใหม่';
    } else if (isInit) {
      maxlen = it.digitLength;
      hint = 'ครั้งแรก — กรอกเลขเต็ม ' + it.digitLength + ' หลัก';
    } else {
      hint = 'ครั้งก่อน <b>' + fmt(it.previousReading, it.digitLength) + '</b> · กรอก ' + it.inputDigits + ' หลักท้าย';
    }

    html += '<div class="mc-body">' +
              '<div class="mc-hint">' + hint + '</div>' +
              '<div class="mc-inrow">' +
                '<input class="mc-input" data-id="' + id + '" data-mode="' + mode + '" type="tel" ' +
                  'inputmode="numeric" maxlength="' + maxlen + '" value="' + value + '" ' +
                  'placeholder="' + (maxlen > 3 ? 'เลขเต็ม' : maxlen + ' หลัก') + '">' +
                '<button class="btn primary mc-save" data-act="save" data-id="' + id + '">' + btnText + '</button>' +
              '</div>';

    if (mode === 'NEW' && !isInit) {
      html += '<label class="mc-fullchk"><input type="checkbox" class="mc-full" data-id="' + id + '"> กรอกเลขเต็มแทน</label>';
    }
    html += '<div class="mc-preview" id="pv-' + id + '"></div></div>';
  }

  html += '</div>';
  return html;
}

/*** ══════════ CLICK / TAP ══════════ ***/
$('meterList').addEventListener('click', function (e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;

  if (act === 'save')        { e.stopPropagation(); saveCard(id); }
  else if (act === 'close')  { e.stopPropagation(); S.openId = null; renderMeters(); }
  else if (act === 'unlock') { e.stopPropagation(); S.openId = id; S.openMode = 'UNLOCK'; renderMeters(); }
  else if (act === 'retry')  { e.stopPropagation(); delete S.failed[id]; S.openId = id; S.openMode = 'NEW'; renderMeters(); }
  else if (act === 'head')   { headTap(id); }
});

function headTap(id) {
  const it = itemOf(id);
  if (S.pending[id]) return;               // กำลังบันทึกอยู่ กดไม่ได้
  if (S.failed[id]) return;

  /* ยังไม่บันทึก → เปิด/ปิด dropdown ตามปกติ */
  if (!it.submitted) {
    S.openId = (S.openId === id) ? null : id;
    S.openMode = 'NEW';
    renderMeters();
    return;
  }

  /* บันทึกแล้ว → นับจำนวนแตะ */
  if (S.openId === id) { S.openId = null; renderMeters(); return; }

  S.taps[id] = (S.taps[id] || 0) + 1;
  clearTimeout(S.tapTimer[id]);

  if (S.taps[id] >= TAP_NEED) {
    S.taps[id] = 0;
    S.openId = id;
    S.openMode = 'EDIT';
    renderMeters();
    toast('เปิดโหมดแก้ไข: ' + it.meterName, 'info');
    return;
  }

  S.tapTimer[id] = setTimeout(function () { S.taps[id] = 0; updateCard(id); }, TAP_RESET_MS);
  updateCard(id);
}

function onFullToggle(e) {
  const id = e.target.dataset.id;
  const it = itemOf(id);
  const inp = document.querySelector('.mc-input');
  inp.maxLength = e.target.checked ? it.digitLength : it.inputDigits;
  inp.placeholder = e.target.checked ? 'เลขเต็ม' : it.inputDigits + ' หลัก';
  inp.value = '';
  inp.dataset.full = e.target.checked ? '1' : '';
  onCardInput({ target: inp });
  inp.focus();
}

/*** ══════════ PREVIEW ══════════ ***/
function onCardInput(e) {
  const inp = e.target;
  const id = inp.dataset.id, mode = inp.dataset.mode;
  const it = itemOf(id);
  const pv = $('pv-' + id);
  const raw = inp.value.replace(/\D/g, '');
  inp.value = raw;
  if (!pv) return;
  if (!raw) { pv.innerHTML = ''; pv.className = 'mc-preview'; return; }

  let full, usage, bad = false;

  if (mode === 'EDIT') {
    full = Number(raw);
    usage = full - it.previousReading;
    bad = usage < 0;
  } else {
    const base = mode === 'UNLOCK' ? it.fullReading : it.previousReading;
    const useFull = inp.dataset.full === '1' || !it.hasBaseline;
    if (useFull) {
      full = Number(raw);
      usage = it.hasBaseline ? calcUsage(base, full, it.digitLength) : 0;
    } else {
      full = computeFull(base, Number(raw), it.inputDigits, it.digitLength);
      usage = calcUsage(base, full, it.digitLength);
    }
  }

  const over = !bad && it.hardLimit && usage > it.hardLimit;
  const warn = !bad && !over && it.normalLimit && usage > it.normalLimit;
  pv.className = 'mc-preview ' + (bad || over ? 'critical' : warn ? 'warn' : 'ok');
  pv.innerHTML = '<b>' + fmt(full, it.digitLength) + '</b> · ใช้ <b>' + usage + '</b> หน่วย ' +
    (bad ? '⛔ ติดลบ ตรวจสอบอีกครั้ง'
         : over ? '⛔ สูงผิดปกติมาก'
         : warn ? '🔴 สูงกว่าเกณฑ์ ' + it.normalLimit
         : '🟢 ปกติ');
}

/*** ══════════ SAVE เบื้องหลัง (ไม่บล็อกหน้าจอ) ══════════ ***/
function applySaved(id, patch) {
  const it = itemOf(id);
  Object.assign(it, patch);
  it.submitted = true;
}

async function saveCard(id) {
  const it = itemOf(id);
  const inp = document.querySelector('.mcard[data-mid="' + id + '"] .mc-input');
  if (!inp) return;
  const raw = inp.value.replace(/\D/g, '');
  if (!raw) { toast('กรุณากรอกตัวเลขก่อน', 'err'); return; }

  const mode = inp.dataset.mode;
  const useFull = inp.dataset.full === '1' || !it.hasBaseline;

  /* ปิด dropdown + ทำให้ซีดทันที ไม่ต้องรอเซิร์ฟเวอร์ */
  S.openId = null;
  S.pending[id] = true;
  delete S.failed[id];
  renderMeters();

  /* ── ออฟไลน์: เก็บคิวไว้ก่อน ── */
  if (!navigator.onLine && mode !== 'EDIT') {
    const entry = {
      readingId: uuid(), meterId: id, value: raw,
      mode: useFull ? 'FULL' : 'SUFFIX',
      force: mode === 'UNLOCK', source: 'OFFLINE_SYNC'
    };
    const q = LS.q; q.push({ date: S.viewDate, session: S.session, entries: [entry] }); LS.q = q;

    const base = mode === 'UNLOCK' ? it.fullReading : it.previousReading;
    const full = useFull ? Number(raw) : computeFull(base, Number(raw), it.inputDigits, it.digitLength);
    delete S.pending[id];
    S.queued[id] = true;
    applySaved(id, { fullReading: full, usageUnits: calcUsage(base, full, it.digitLength), status: 'NORMAL', inputValue: raw });
    updateCard(id); refreshStats(); renderQueue();
    toast('☁️ เก็บไว้ในเครื่อง รอส่งเมื่อออนไลน์', 'warn');
    return;
  }

  try {
    if (mode === 'EDIT') {
      const r = await api('editReading', { readingId: it.readingId, value: raw, mode: 'FULL' });
      applySaved(id, {
        fullReading: r.fullReading, usageUnits: r.usageUnits,
        status: r.status, inputValue: raw
      });
      toast('✏️ ' + it.meterName + ' → ' + r.fullReading + ' (' + r.usageUnits + ' หน่วย)');
    } else {
      const entry = {
        readingId: uuid(), meterId: id, value: raw,
        mode: useFull ? 'FULL' : 'SUFFIX',
        force: mode === 'UNLOCK', source: 'ONLINE', confirmed: false
      };
      let r = await api('submitReadings', { date: S.viewDate, session: S.session, entries: [entry] });
      let res = r.results[0];

      /* ค่าสูงกว่าเกณฑ์ → ถามยืนยันแล้วส่งซ้ำ */
      if (res && res.needConfirm) {
        delete S.pending[id]; updateCard(id);
        const okc = confirm(it.meterName + '\nใช้น้ำ ' + res.previewUsage + ' หน่วย สูงกว่าเกณฑ์\n\nยืนยันบันทึกหรือไม่?');
        if (!okc) { toast('ยกเลิกการบันทึก', 'warn'); return; }
        S.pending[id] = true; updateCard(id);
        entry.confirmed = true;
        r = await api('submitReadings', { date: S.viewDate, session: S.session, entries: [entry] });
        res = r.results[0];
      }

      if (!res || !res.ok) throw new Error((res && res.error) || 'บันทึกไม่สำเร็จ');

      applySaved(id, {
        fullReading: res.fullReading, usageUnits: res.usageUnits,
        status: res.status, readingId: res.readingId,
        inputValue: raw, submittedBy: S.user.email
      });
      toast('✅ ' + it.meterName + ' · ' + res.fullReading + ' (' + res.usageUnits + ' หน่วย)');
    }
  } catch (e) {
    S.failed[id] = e.message;
    toast('⚠️ ' + it.meterName + ': ' + e.message, 'err');
  } finally {
    delete S.pending[id];
    updateCard(id);
    refreshStats();
  }
}

/*** ══════════ OFFLINE QUEUE ══════════ ***/
function renderQueue() {
  const q = LS.q, bar = $('queueBar');
  bar.classList.toggle('hidden', !q.length);
  if (q.length) bar.textContent = '☁️ มี ' + q.length + ' รายการรอส่งเมื่อกลับมาออนไลน์';
}

async function flushQueue() {
  if (!navigator.onLine) return;
  const q = LS.q;
  if (!q.length) return;
  LS.q = [];
  let okCount = 0;
  for (const b of q) {
    try {
      await api('submitReadings', {
        date: b.date,
        session: b.session || 'DAY',
        entries: b.entries.map(e => Object.assign({}, e, { confirmed: true }))
      });
      b.entries.forEach(e => { delete S.queued[e.meterId]; });
      okCount++;
    } catch (e) {
      const c = LS.q; c.push(b); LS.q = c;
    }
  }
  renderQueue();
  if (okCount) { toast('☁️ ส่งข้อมูลค้างสำเร็จ ' + okCount + ' ชุด'); loadDay(false); }
}

window.addEventListener('online', function () { $('netbar').classList.add('hidden'); flushQueue(); });
window.addEventListener('offline', function () { $('netbar').classList.remove('hidden'); });

/*** ══════════ ADMIN: ปลดล็อกทั้งวัน ══════════ ***/
$('btnResetDay').onclick = async function () {
  const date = $('resetDate').value;
  if (!date) return msg('resetMsg', 'กรุณาเลือกวันที่', 'err');

  busy(true);
  let count = 0;
  try {
    const d = await api('getDay', { date: date });
    count = d.stats.submitted;
  } catch (e) { busy(false); return msg('resetMsg', e.message, 'err'); }
  busy(false);

  if (!count) return msg('resetMsg', 'วันที่ ' + date + ' ไม่มีข้อมูลที่ต้องล้าง', 'warn');
  if (!confirm('ปลดล็อกทั้งวัน\n\nวันที่: ' + date + '\nข้อมูลที่จะถูกล้าง: ' + count + ' จุด\n\nดำเนินการต่อหรือไม่?')) return;

  $('rmDate').textContent = date;
  $('rmCount').textContent = count;
  $('rmText').value = '';
  $('rmMsg').textContent = '';
  $('resetModal').classList.remove('hidden');
  setTimeout(() => $('rmText').focus(), 100);
};

$('rmClose').onclick = function () { $('resetModal').classList.add('hidden'); };

$('rmGo').onclick = async function () {
  if ($('rmText').value.trim() !== 'ยืนยัน') return msg('rmMsg', 'กรุณาพิมพ์คำว่า ยืนยัน ให้ถูกต้อง', 'err');
  const date = $('resetDate').value;
  busy(true);
  try {
    const r = await api('voidDay', { date: date, confirmText: 'ยืนยัน' });
    $('resetModal').classList.add('hidden');
    msg('resetMsg', '✅ ล้างข้อมูลวันที่ ' + r.date + ' แล้ว ' + r.cleared + ' รายการ', 'ok');
    if (S.viewDate === date) { S.pending = {}; S.failed = {}; S.queued = {}; await loadDay(false); }
  } catch (e) { msg('rmMsg', e.message, 'err'); }
  finally { busy(false); }
};

/*** ══════════ REPORT ══════════ ***/
$('btnLoadSum').onclick = loadSummaryReport;
$('optPad').onchange = function () { if (S.reportData) renderSummaryPreview(S.reportData); };
$('optUsage').onchange = function () { if (S.reportData) renderSummaryPreview(S.reportData); };

async function loadSummaryReport() {
  const date = $('sumDate').value;
  if (!date) return msg('summaryMsg', 'กรุณาเลือกวันที่', 'err');
  busy(true);
  try {
    const d = await api('getDay', { date: date });
    S.reportData = d;
    $('imgBox').classList.add('hidden');
    renderSummaryPreview(d);
    msg('summaryMsg', 'โหลดข้อมูลแล้ว กด "สร้างรูปภาพรายงาน" เพื่อทำรูปส่ง LINE', 'ok');
  } catch (e) { msg('summaryMsg', e.message, 'err'); }
  finally { busy(false); }
}

function readingText(it) {
  if (it.fullReading === null || it.fullReading === undefined) return '';
  return $('optPad').checked ? fmt(it.fullReading, it.digitLength) : String(it.fullReading);
}

function thaiHeaderDate(dateStr) {
  const p = String(dateStr).split('-');
  return { d: String(Number(p[2])), m: String(Number(p[1])), y: String((Number(p[0]) + 543) % 100).padStart(2, '0') };
}

function renderSummaryPreview(d) {
  const showUsage = $('optUsage').checked;
  const t = thaiHeaderDate(d.date);
  const round = $('sumRound').value;

  let h = '<div class="rp">';
  h += '<div class="rp-date"><span>วันที่</span><b>' + t.d + '</b><span>/</span><b>' + t.m + '</b><span>/</span><b>' + t.y + '</b></div>';
  h += '<div class="rp-title">มิเตอร์น้ำ' + (round ? ' (' + round + ')' : '') + '</div>';
  h += '<div class="rp-row rp-head' + (showUsage ? ' u' : '') + '">' +
        '<div></div><div>จุดที่ตั้งมิเตอร์</div><div>จุดที่ใช้น้ำ</div><div>เลขมิเตอร์</div>' +
        (showUsage ? '<div>ใช้ไป</div>' : '') + '</div>';

  d.items.forEach(function (it, i) {
    const cls = it.status === 'REVIEW' ? ' rp-crit' : it.status === 'ALERT' ? ' rp-alert' : '';
    h += '<div class="rp-row' + (showUsage ? ' u' : '') + cls + '">' +
          '<div class="rp-no">' + (i + 1) + '</div>' +
          '<div class="rp-nm">' + it.meterName + '</div>' +
          '<div class="rp-lc">' + (it.location || '') + '</div>' +
          '<div class="rp-nu">' + readingText(it) + '</div>' +
          (showUsage ? '<div class="rp-us">' + (it.usageUnits !== null ? it.usageUnits : '') + '</div>' : '') +
        '</div>';
  });

  h += '</div>';
  h += '<div class="rp-sum">บันทึกแล้ว ' + d.stats.submitted + '/' + d.stats.total +
       ' · รวม ' + d.stats.totalUsage + ' หน่วย' +
       (d.stats.alert ? ' · ⚠️ ผิดปกติ ' + d.stats.alert + ' จุด' : '') + '</div>';

  $('summaryWrap').innerHTML = h;
}

$('btnMakeImg').onclick = async function () {
  if (!S.reportData) return msg('summaryMsg', 'กรุณากด "ดูรายงาน" ก่อน', 'err');
  busy(true);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = drawReportCanvas(S.reportData);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png', 1));
    S.reportBlob = blob;
    $('reportImg').src = URL.createObjectURL(blob);
    $('imgBox').classList.remove('hidden');
    $('imgBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    msg('summaryMsg', 'สร้างรูปเรียบร้อย', 'ok');
  } catch (e) { msg('summaryMsg', 'สร้างรูปไม่สำเร็จ: ' + e.message, 'err'); }
  finally { busy(false); }
};

function fitFont(ctx, text, maxW, size, weight) {
  let s = size;
  const fam = '"Noto Sans Thai","Sarabun","Segoe UI",sans-serif';
  ctx.font = weight + ' ' + s + 'px ' + fam;
  while (ctx.measureText(text).width > maxW && s > 11) {
    s -= 1;
    ctx.font = weight + ' ' + s + 'px ' + fam;
  }
  return s;
}

function drawReportCanvas(d) {
  const showUsage = $('optUsage').checked;
  const round = $('sumRound').value;
  const items = d.items;
  const t = thaiHeaderDate(d.date);

  const SC = 2;
  const W = showUsage ? 1060 : 960;
  const PAD = 16;
  const hDate = 62, hTitle = 50, hHead = 54, hRow = 48, hFoot = 44;
  const H = PAD * 2 + hDate + hTitle + hHead + hRow * items.length + hFoot;

  const cv = $('reportCanvas');
  cv.width = W * SC; cv.height = H * SC;
  const x = cv.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.scale(SC, SC);
  x.textBaseline = 'middle';

  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);

  const L = PAD, R = W - PAD, IW = R - L;
  const cols = showUsage ? [70, 300, 300, 210, 180] : [70, 340, 340, 210];
  const sum = cols.reduce((a, b) => a + b, 0);
  const cw = cols.map(c => c / sum * IW);
  const cx = [L];
  for (let i = 0; i < cw.length; i++) cx.push(cx[i] + cw[i]);

  const line = (x1, y1, x2, y2, lw) => {
    x.strokeStyle = '#fff'; x.lineWidth = lw || 1.6;
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
  };

  let y = PAD;

  x.strokeStyle = '#fff'; x.lineWidth = 3;
  x.strokeRect(L, y, IW, hDate);
  const my = y + hDate / 2;
  x.fillStyle = '#fff'; x.textAlign = 'left';
  x.font = 'bold 30px "Noto Sans Thai","Sarabun",sans-serif';
  x.fillText('วันที่', L + 14, my);
  x.textAlign = 'center';
  x.font = 'bold 32px "Noto Sans Thai","Sarabun",sans-serif';
  x.fillText(t.d, L + IW * 0.34, my);
  x.fillText('/', L + IW * 0.44, my);
  x.fillText(t.m, L + IW * 0.54, my);
  x.fillText('/', L + IW * 0.76, my);
  x.fillText(t.y, L + IW * 0.86, my);
  y += hDate;

  x.strokeRect(L, y, IW, hTitle);
  x.textAlign = 'center';
  x.font = 'bold 28px "Noto Sans Thai","Sarabun",sans-serif';
  x.fillText('มิเตอร์น้ำ' + (round ? ' (' + round + ')' : ''), L + IW / 2, y + hTitle / 2);
  y += hTitle;

  const headTop = y;
  x.strokeRect(L, y, IW, hHead);
  const heads = showUsage
    ? ['', 'จุดที่ตั้งมิเตอร์', 'จุดที่ใช้น้ำ', 'เลขมิเตอร์', 'ใช้ไป']
    : ['', 'จุดที่ตั้งมิเตอร์', 'จุดที่ใช้น้ำ', 'เลขมิเตอร์'];
  heads.forEach(function (h, i) {
    if (!h) return;
    const s = fitFont(x, h, cw[i] - 16, 26, 'bold');
    x.font = 'bold ' + s + 'px "Noto Sans Thai","Sarabun",sans-serif';
    x.textAlign = 'center';
    x.fillText(h, cx[i] + cw[i] / 2, y + hHead / 2);
  });
  for (let i = 1; i < cx.length - 1; i++) line(cx[i], headTop, cx[i], headTop + hHead, 2);
  y += hHead;

  items.forEach(function (it, idx) {
    const top = y;
    x.strokeStyle = '#fff'; x.lineWidth = 1.6;
    x.strokeRect(L, top, IW, hRow);
    for (let i = 1; i < cx.length - 1; i++) line(cx[i], top, cx[i], top + hRow, 1.6);
    const cy = top + hRow / 2;

    x.fillStyle = '#fff'; x.textAlign = 'center';
    x.font = '25px "Noto Sans Thai","Sarabun",sans-serif';
    x.fillText(String(idx + 1), cx[0] + cw[0] / 2, cy);

    let s = fitFont(x, it.meterName, cw[1] - 18, 25, '600');
    x.font = '600 ' + s + 'px "Noto Sans Thai","Sarabun",sans-serif';
    x.fillText(it.meterName, cx[1] + cw[1] / 2, cy);

    const loc = it.location || '';
    s = fitFont(x, loc, cw[2] - 18, 25, '600');
    x.font = '600 ' + s + 'px "Noto Sans Thai","Sarabun",sans-serif';
    x.fillText(loc, cx[2] + cw[2] / 2, cy);

    const num = readingText(it);
    x.fillStyle = (it.status === 'ALERT' || it.status === 'REVIEW') ? '#ff8f8f' : '#fff';
    s = fitFont(x, num, cw[3] - 18, 30, 'bold');
    x.font = 'bold ' + s + 'px "Noto Sans Thai","Sarabun",sans-serif';
    x.fillText(num, cx[3] + cw[3] / 2, cy);

    if (showUsage) {
      x.fillStyle = (it.status === 'ALERT' || it.status === 'REVIEW') ? '#ff8f8f' : '#c9d4e3';
      x.font = '600 24px "Noto Sans Thai","Sarabun",sans-serif';
      x.fillText(it.usageUnits !== null ? String(it.usageUnits) : '', cx[4] + cw[4] / 2, cy);
    }
    y += hRow;
  });

  x.fillStyle = '#9aa7b5';
  x.textAlign = 'left';
  x.font = '20px "Noto Sans Thai","Sarabun",sans-serif';
  x.fillText('บันทึก ' + d.stats.submitted + '/' + d.stats.total +
             ' · รวม ' + d.stats.totalUsage + ' หน่วย', L + 4, y + hFoot / 2);
  x.textAlign = 'right';
  x.fillText(new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }), R - 4, y + hFoot / 2);

  return cv;
}

function reportFileName() {
  const r = $('sumRound').value;
  return 'meter_' + $('sumDate').value + (r ? '_' + r : '') + '.png';
}

$('btnShareImg').onclick = async function () {
  if (!S.reportBlob) return;
  const file = new File([S.reportBlob], reportFileName(), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'รายงานมิเตอร์น้ำ ' + $('sumDate').value }); }
    catch (e) {}
  } else {
    alert('อุปกรณ์นี้ยังไม่รองรับการแชร์ไฟล์โดยตรง\n\nกรุณากด "บันทึกรูป" แล้วส่งเข้า LINE จากคลังภาพแทนครับ');
  }
};

$('btnDownImg').onclick = function () {
  if (!S.reportBlob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(S.reportBlob);
  a.download = reportFileName();
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

/*** ══════════ HISTORY ══════════ ***/
$('btnLoadHis').onclick = async function () {
  busy(true);
  try {
    const h = await api('history', { meterId: $('hisMeter').value, limit: 120 });
    $('historyBox').innerHTML = h.rows.map(r =>
      '<div class="srow">' +
        '<div class="sname">' + r.date + '<br><small>' + (r.meterName || nameOf(r.meterId)) + '</small></div>' +
        '<div class="snum">' + r.fullReading + '</div>' +
        '<div class="suse ' + pillOf(r.status) + '">' + r.usageUnits + '</div>' +
      '</div>').join('') || '<div class="empty">ไม่มีข้อมูล</div>';
  } catch (e) { alert(e.message); } finally { busy(false); }
};

/*** ══════════ ADMIN: USERS ══════════ ***/
async function loadUsers() {
  busy(true);
  try {
    const r = await api('listUsers');
    $('userList').innerHTML = r.users.map(u =>
      '<div class="ucard' + (u.active ? '' : ' off') + '">' +
        '<div class="uc-head"><b>' + (u.displayName || u.email) + '</b>' +
        '<span class="pill ' + (u.role === 'ADMIN' ? 'red' : u.role === 'RECORDER' ? 'green' : 'gray') + '">' + u.role + '</span></div>' +
        '<div class="uc-mail">' + u.email + ' · ' + (u.active ? '🟢 ใช้งาน' : '⚪ ปิด') + '</div>' +
        '<div class="row admin-actions">' +
          '<button class="btn small" data-uact="edit" data-email="' + u.email + '">✏️ แก้ไข</button>' +
          '<button class="btn small warn" data-uact="del" data-email="' + u.email + '">🗑 ลบ</button>' +
        '</div>' +
      '</div>').join('');
    window.__users = r.users;
  } catch (e) { alert(e.message); } finally { busy(false); }
}

$('userList').addEventListener('click', function (e) {
  const btn = e.target.closest('[data-uact]');
  if (!btn) return;
  const email = btn.dataset.email;
  if (btn.dataset.uact === 'edit') openUserModal((window.__users || []).find(u => u.email === email));
  else delUser(email);
});

function openUserModal(u) {
  $('umTitle').textContent = u ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้';
  $('umEmail').value = u ? u.email : '';
  $('umEmail').disabled = !!u;
  $('umName').value = u ? u.displayName : '';
  $('umPin').value = u ? u.pin : '';
  $('umRole').value = u ? u.role : 'RECORDER';
  $('umActive').checked = u ? u.active : true;
  $('umNote').value = u ? u.note : '';
  $('umMsg').textContent = '';
  $('userModal').classList.remove('hidden');
}
function closeUserModal() { $('userModal').classList.add('hidden'); }

$('umClose').onclick = closeUserModal;
$('btnNewUser').onclick = function () { openUserModal(null); };
$('btnReloadUsers').onclick = loadUsers;

$('umSave').onclick = async function () {
  const u = {
    email: $('umEmail').value.trim(),
    displayName: $('umName').value.trim(),
    pin: $('umPin').value.replace(/\D/g, ''),
    role: $('umRole').value,
    active: $('umActive').checked,
    allowedMeters: 'ALL',
    note: $('umNote').value.trim()
  };
  busy(true);
  try { await api('saveUser', { user: u }); closeUserModal(); await loadUsers(); }
  catch (e) { msg('umMsg', e.message, 'err'); }
  finally { busy(false); }
};

async function delUser(email) {
  if (!confirm('ลบผู้ใช้ ' + email + ' ออกจากระบบ?')) return;
  busy(true);
  try { await api('deleteUser', { targetEmail: email }); await loadUsers(); }
  catch (e) { alert(e.message); } finally { busy(false); }
}

/*** ══════════ PWA INSTALL ══════════ ***/
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  deferredPrompt = e;
  $('btnInstall').classList.remove('hidden');
  $('btnInstallLogin').classList.remove('hidden');
});

async function doInstall() {
  if (!deferredPrompt) {
    alert('วิธีติดตั้งด้วยตนเอง\n\n' +
          '• iPhone / iPad — กดปุ่มแชร์ แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"\n' +
          '• Android — เมนู ⋮ แล้วเลือก "ติดตั้งแอป"\n' +
          '• คอมพิวเตอร์ — ไอคอนติดตั้งท้ายแถบที่อยู่เว็บ');
    return;
  }
  deferredPrompt.prompt();
  const res = await deferredPrompt.userChoice;
  if (res.outcome === 'accepted') {
    $('btnInstall').classList.add('hidden');
    $('btnInstallLogin').classList.add('hidden');
  }
  deferredPrompt = null;
}

$('btnInstall').onclick = doInstall;
$('btnInstallLogin').onclick = doInstall;

window.addEventListener('appinstalled', function () {
  $('btnInstall').classList.add('hidden');
  $('btnInstallLogin').classList.add('hidden');
  deferredPrompt = null;
});

/*** ══════════ TABS ══════════ ***/
document.querySelectorAll('.tab').forEach(function (t) {
  t.onclick = function () {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('.tabpanel').forEach(p => p.classList.add('hidden'));
    $('tab-' + t.dataset.tab).classList.remove('hidden');
    if (t.dataset.tab === 'admin') loadUsers();
  };
});

/*** ══════════ INIT ══════════ ***/
(async function init() {
  if (!navigator.onLine) $('netbar').classList.remove('hidden');
  renderQueue();

  const s = LS.s;
  if (s) {
    S.user = s;
    busy(true);
    try { await start(); }
    catch (e) { localStorage.removeItem('wm_session'); S.user = null; }
    finally { busy(false); }
  } else if (window.AUTO_LOGIN && window.AUTO_LOGIN.username) {
    busy(true);
    try {
      const u = await api('login', { email: window.AUTO_LOGIN.username, pin: window.AUTO_LOGIN.pin });
      S.user = Object.assign({}, u, { pin: window.AUTO_LOGIN.pin });
      LS.s = S.user;
      await start();
    } catch (e) {
      msg('loginMsg', 'เข้าสู่ระบบอัตโนมัติไม่สำเร็จ: ' + e.message, 'err');
      if ($('bootError')) {
        $('bootError').textContent = '⚠️ เข้าสู่ระบบอัตโนมัติไม่สำเร็จ: ' + e.message;
        $('bootError').classList.remove('hidden');
      }
    } finally { busy(false); }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js')
        .then(r => console.log('SW ready:', r.scope))
        .catch(e => console.warn('SW failed:', e));
    });
  }
})();
