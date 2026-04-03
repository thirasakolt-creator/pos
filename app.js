// =====================================================================
// POS Pro v3
// Session ค้างไว้ใน localStorage จนกว่าจะ "ปิดร้าน"
// =====================================================================

const CONFIG = { SHEETS_URL:'', SYNC_MS: 60*60*1000, DEFAULT_MGR_PIN:'1234' };

const DB = {
  get:(k)=>{ try{return JSON.parse(localStorage.getItem('pos3_'+k))}catch{return null} },
  set:(k,v)=>{ try{localStorage.setItem('pos3_'+k,JSON.stringify(v));return true}catch{return false} },
  del:(k)=>localStorage.removeItem('pos3_'+k),
};

// ── PIN input buffers (ไม่ต้องเก็บใน session) ──
let _mgrPin='', _staffPin='', _selectedStaffId=null, _syncTimer=null;

// ═══════════════════════════════════════════
//  PREVENT ZOOM (double-tap, pinch, etc.)
// ═══════════════════════════════════════════
function preventZoom() {
  // ปิด double-tap zoom
  let lastTouch = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouch < 300) {
      e.preventDefault();
    }
    lastTouch = now;
  }, { passive: false });

  // ปิด pinch zoom
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // ปิด wheel zoom (Ctrl+scroll บน Windows)
  document.addEventListener('wheel', e => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });

  // ปิด keyboard zoom (Ctrl+/-)
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
      e.preventDefault();
    }
  });
}

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
function initApp() {
  preventZoom();
  initDefaultData();
  setupNetwork();
  setupClock();
  registerSW();

  // ── ตรวจว่ามี session ค้างอยู่ไหม ──
  const sess = DB.get('session');
  if (sess && sess.active) {
    enterApp(false);  // ไม่ต้องดึง Sheets ใหม่
  } else {
    showScreen('login');
    showLoginStep('step-role');
  }
  hideLoading();
}

function initDefaultData() {
  if (!DB.get('products')) DB.set('products',[
    {id:1,name:'น้ำดื่ม 600ml',price:7, stock:48,minStock:10,emoji:'💧',cat:'drink',cost:3},
    {id:2,name:'โค้ก 325ml',   price:15,stock:24,minStock:6, emoji:'🥤',cat:'drink',cost:8},
    {id:3,name:'กาแฟเย็น',     price:35,stock:3, minStock:5, emoji:'☕',cat:'drink',cost:15},
    {id:4,name:'ข้าวผัดหมู',   price:50,stock:8, minStock:3, emoji:'🍳',cat:'food', cost:20},
    {id:5,name:'ก๋วยเตี๋ยว',   price:45,stock:12,minStock:3, emoji:'🍜',cat:'food', cost:18},
    {id:6,name:'เลย์ 34g',     price:20,stock:36,minStock:10,emoji:'🍟',cat:'snack',cost:10},
  ]);
  if (!DB.get('sales'))     DB.set('sales',[]);
  if (!DB.get('syncQueue')) DB.set('syncQueue',[]);
  if (!DB.get('settings'))  DB.set('settings',{shopName:'ร้านของฉัน',phone:'',address:'',sheetsUrl:''});
  if (!DB.get('mgrPin'))    DB.set('mgrPin',CONFIG.DEFAULT_MGR_PIN);
  if (!DB.get('staff'))     DB.set('staff',[
    {id:'s1',name:'สมชาย ใจดี',  pin:'1111',role:'staff'},
    {id:'s2',name:'สมหญิง รักดี',pin:'2222',role:'staff'},
  ]);
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el = document.getElementById('screen-'+name);
  if (el) el.classList.add('active');
}

// ═══════════════════════════════════════════
//  LOGIN — STEP ROUTING
// ═══════════════════════════════════════════
function showLoginStep(id) {
  ['step-role','step-mgr-pin','step-staff-select','step-staff-pin','step-count-float']
    .forEach(s=>{ const el=document.getElementById(s); if(el) el.style.display='none'; });
  const el = document.getElementById(id);
  if (el) el.style.display='block';
}

function chooseRole(role) {
  if (role === 'mgr') {
    _mgrPin = '';
    renderPinDots('mgrPinDots', 0);
    showLoginStep('step-mgr-pin');
  } else {
    renderStaffPickList();
    showLoginStep('step-staff-select');
  }
}

function backToRole() { showLoginStep('step-role'); }
function backToStaffSelect() {
  _staffPin = '';
  renderStaffPickList();
  showLoginStep('step-staff-select');
}

// ═══════════════════════════════════════════
//  PIN INPUT
// ═══════════════════════════════════════════
function pinKey(who, digit) {
  if (who === 'mgr') {
    if (_mgrPin.length >= 8) return;
    _mgrPin += digit;
    renderPinDots('mgrPinDots', _mgrPin.length);
  } else {
    if (_staffPin.length >= 8) return;
    _staffPin += digit;
    renderPinDots('staffPinDots', _staffPin.length);
  }
}
function pinDel(who) {
  if (who==='mgr') { _mgrPin=_mgrPin.slice(0,-1); renderPinDots('mgrPinDots',_mgrPin.length); }
  else             { _staffPin=_staffPin.slice(0,-1); renderPinDots('staffPinDots',_staffPin.length); }
}
function pinClear(who) {
  if (who==='mgr') { _mgrPin=''; renderPinDots('mgrPinDots',0); }
  else             { _staffPin=''; renderPinDots('staffPinDots',0); }
}
function renderPinDots(elId, len) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = Array(Math.max(len,6)).fill(0).map((_,i)=>
    `<div class="pin-dot${i<len?' filled':''}"></div>`
  ).join('');
}
function shakePinDots(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.add('error');
  setTimeout(()=>el.classList.remove('error'), 600);
}

// ═══════════════════════════════════════════
//  CONFIRM MANAGER
// ═══════════════════════════════════════════
function confirmMgr() {
  const correct = DB.get('mgrPin') || CONFIG.DEFAULT_MGR_PIN;
  if (_mgrPin === correct) {
    // Save session as manager
    DB.set('session',{ active:true, role:'mgr', name:'ผู้จัดการ', startedAt: new Date().toISOString(), float:0 });
    _mgrPin = '';
    enterApp(true);  // ดึงข้อมูลจาก Sheets
  } else {
    shakePinDots('mgrPinDots');
    _mgrPin = '';
    renderPinDots('mgrPinDots',0);
    showToast('❌ รหัสผิด','error');
  }
}

// ═══════════════════════════════════════════
//  STAFF SELECT → PIN → COUNT FLOAT
// ═══════════════════════════════════════════
function renderStaffPickList() {
  const list = DB.get('staff') || [];
  const el = document.getElementById('staffPickList');
  if (!el) return;
  if (list.length === 0) {
    el.innerHTML = '<div style="color:var(--t2);text-align:center;padding:16px;font-size:13px;">ยังไม่มีพนักงาน<br>ผจก. เพิ่มได้ในเมนูตั้งค่า</div>';
    return;
  }
  el.innerHTML = list.map(s=>`
    <div class="staff-pick-item" id="spi_${s.id}" onclick="selectStaff('${s.id}')">
      <div class="spi-avatar">${s.name.charAt(0)}</div>
      <div><div class="spi-name">${s.name}</div><div class="spi-role">${s.role==='senior'?'⭐ อาวุโส':'👤 พนักงาน'}</div></div>
    </div>`).join('');
}

function selectStaff(id) {
  _selectedStaffId = id;
  const list = DB.get('staff') || [];
  const staff = list.find(s=>s.id===id);
  if (!staff) return;
  document.getElementById('staffPinTitle').textContent = '🧑‍💼 ' + staff.name;
  _staffPin = '';
  renderPinDots('staffPinDots',0);
  showLoginStep('step-staff-pin');
}

function confirmStaff() {
  const list = DB.get('staff') || [];
  const staff = list.find(s=>s.id===_selectedStaffId);
  if (!staff) { showToast('❌ ไม่พบพนักงาน','error'); return; }
  if (_staffPin === staff.pin) {
    // ไปหน้านับเงิน
    document.getElementById('floatSetDisplay').textContent = '฿0'; // ไม่มีผจก. ตั้งไว้ล่วงหน้าในระบบใหม่นี้
    document.getElementById('floatCountInput').value = '';
    document.getElementById('floatDiffMsg').className = 'float-diff none';
    // เก็บ pending session
    DB.set('pendingStaff', { id: staff.id, name: staff.name, role: staff.role });
    _staffPin = '';
    showLoginStep('step-count-float');
  } else {
    shakePinDots('staffPinDots');
    _staffPin = '';
    showToast('❌ รหัสพนักงานผิด','error');
  }
}

function updateFloatDiff() {
  const val = parseFloat(document.getElementById('floatCountInput').value) || 0;
  const el = document.getElementById('floatDiffMsg');
  if (val > 0) {
    el.textContent = `✅ รับทราบ — เงินทอน ฿${val.toLocaleString('th')} บาท`;
    el.className = 'float-diff ok';
  } else {
    el.className = 'float-diff none';
  }
}

function confirmFloat() {
  const val = parseFloat(document.getElementById('floatCountInput').value) || 0;
  const pending = DB.get('pendingStaff');
  if (!pending) { showToast('❌ ข้อมูลพนักงานหาย','error'); return; }
  DB.set('session',{
    active: true,
    role:   pending.role,
    name:   pending.name,
    id:     pending.id,
    float:  val,
    startedAt: new Date().toISOString(),
  });
  DB.del('pendingStaff');
  enterApp(true);
}

// ═══════════════════════════════════════════
//  ENTER APP
// ═══════════════════════════════════════════
function enterApp(pullFromSheets) {
  const sess = DB.get('session') || {};
  showScreen('app');

  // User chip
  const userEl = document.getElementById('topbarUser');
  if (userEl) userEl.textContent = (sess.role==='mgr'?'👔 ':'👤 ') + (sess.name||'—');

  // Manager tabs
  const isMgr = sess.role === 'mgr';
  document.querySelectorAll('.mgr-tab').forEach(b=>b.classList.toggle('show', isMgr));

  // Sync settings
  const s = DB.get('settings') || {};
  if (s.sheetsUrl) CONFIG.SHEETS_URL = s.sheetsUrl;

  updateStatusBadge();
  renderProducts();
  renderCart();
  renderSyncChip();
  setupSyncTimer();

  if (pullFromSheets) {
    setTimeout(()=>syncFromSheets(), 1500);
  }
}

// ═══════════════════════════════════════════
//  CLOSE SHOP (ปิดร้าน)
// ═══════════════════════════════════════════
async function confirmCloseShop() {
  const sess = DB.get('session') || {};
  // Staff ต้องให้ manager ยืนยัน
  if (sess.role !== 'mgr') {
    const pin = prompt('🔐 ปิดร้าน — กรอกรหัสผู้จัดการ:');
    if (!pin) return;
    const correct = DB.get('mgrPin') || CONFIG.DEFAULT_MGR_PIN;
    if (pin !== correct) { showToast('❌ รหัสผิด','error'); return; }
  }
  if (!confirm('ยืนยันปิดร้านและ Sync ข้อมูลทั้งหมด?')) return;
  showLoading('กำลังปิดร้านและ Sync...');
  await syncToSheets(true);
  DB.del('session');
  hideLoading();
  showToast('🌙 ปิดร้านเรียบร้อย','success');
  // กลับหน้า login
  setTimeout(()=>{
    showScreen('login');
    showLoginStep('step-role');
    // reset state
    document.querySelectorAll('.mgr-tab').forEach(b=>b.classList.remove('show'));
    closeAllTabs();
  }, 800);
}

// ═══════════════════════════════════════════
//  SETTINGS (manager only, เปิดจาก ⚙️)
// ═══════════════════════════════════════════
function openSettings() {
  const sess = DB.get('session') || {};
  if (sess.role !== 'mgr') {
    const pin = prompt('🔐 ตั้งค่า — กรอกรหัสผู้จัดการ:');
    if (!pin) return;
    const correct = DB.get('mgrPin') || CONFIG.DEFAULT_MGR_PIN;
    if (pin !== correct) { showToast('❌ รหัสผิด','error'); return; }
  }
  loadSettingsPage();
  document.getElementById('tab-settings').style.display = 'flex';
}

function loadSettingsPage() {
  const s = DB.get('settings') || {};
  setValue('shopName', s.shopName||'');
  setValue('shopPhone', s.phone||'');
  setValue('shopAddr', s.address||'');
  setValue('sheetsUrl', s.sheetsUrl||'');
  // show first tab
  ['st-shop','st-staff','st-sync'].forEach((id,i)=>{
    const e = document.getElementById(id); if(e) e.style.display = i===0?'block':'none';
  });
  document.querySelectorAll('#tab-settings .stab').forEach((b,i)=>b.classList.toggle('active',i===0));
}

function settingsTab(tab, el) {
  document.querySelectorAll('#tab-settings .stab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  ['st-shop','st-staff','st-sync'].forEach(id=>{ const e=document.getElementById(id); if(e) e.style.display='none'; });
  const target = document.getElementById('st-'+tab);
  if (target) target.style.display = 'block';
  if (tab==='staff') renderStaffAdmin();
  if (tab==='sync')  renderSyncStatus();
}

function saveShopSettings() {
  const s = DB.get('settings') || {};
  s.shopName = getValue('shopName') || 'ร้านของฉัน';
  s.phone    = getValue('shopPhone');
  s.address  = getValue('shopAddr');
  DB.set('settings', s);
  showToast('✅ บันทึกแล้ว','success');
}
function saveSyncSettings() {
  const s = DB.get('settings') || {};
  s.sheetsUrl = getValue('sheetsUrl');
  DB.set('settings', s);
  CONFIG.SHEETS_URL = s.sheetsUrl;
  showToast('✅ บันทึก URL แล้ว','success');
}
function saveMgrPin() {
  const pin = getValue('newMgrPin');
  if (!pin || pin.length < 4) { showToast('⚠️ PIN ต้องมีอย่างน้อย 4 หลัก','error'); return; }
  DB.set('mgrPin', pin);
  setValue('newMgrPin','');
  showToast('✅ เปลี่ยนรหัส ผจก. แล้ว','success');
}
function renderSyncStatus() {
  const q = DB.get('syncQueue')||[];
  setText('queueCountDisp', q.length);
  const ls = DB.get('lastSync');
  setText('lastSyncDisp', ls ? new Date(ls).toLocaleString('th-TH') : 'ยังไม่เคย');
}

// ═══════════════════════════════════════════
//  STAFF MANAGEMENT
// ═══════════════════════════════════════════
function renderStaffAdmin() {
  const list = DB.get('staff') || [];
  const el = document.getElementById('staffAdminList');
  if (!el) return;
  if (list.length===0) { el.innerHTML='<div style="color:var(--t2);padding:12px;text-align:center">ยังไม่มีพนักงาน</div>'; return; }
  el.innerHTML = list.map(s=>`
    <div class="staff-admin-item">
      <div class="sai-avatar">${s.name.charAt(0)}</div>
      <div class="sai-info">
        <div class="sai-name">${s.name}</div>
        <div class="sai-role">${s.role==='senior'?'⭐ อาวุโส':'👤 พนักงาน'} · PIN: ${'•'.repeat(s.pin.length)}</div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="deleteStaff('${s.id}')">ลบ</button>
    </div>`).join('');
}
function openAddStaffModal() {
  setValue('newStaffName',''); setValue('newStaffPin','');
  openModal('addStaffModal');
}
function saveNewStaff() {
  const name = getValue('newStaffName');
  const pin  = getValue('newStaffPin');
  const role = getValue('newStaffRole')||'staff';
  if (!name || pin.length < 4) { showToast('⚠️ กรอกชื่อและ PIN อย่างน้อย 4 หลัก','error'); return; }
  const list = DB.get('staff') || [];
  list.push({ id:'s'+Date.now(), name, pin, role });
  DB.set('staff', list);
  closeModal('addStaffModal');
  renderStaffAdmin();
  showToast(`✅ เพิ่ม ${name} แล้ว`,'success');
}
function deleteStaff(id) {
  if (!confirm('ลบพนักงานคนนี้?')) return;
  DB.set('staff', (DB.get('staff')||[]).filter(s=>s.id!==id));
  renderStaffAdmin();
  showToast('✅ ลบแล้ว','success');
}
function clearAllData() {
  if (!confirm('⚠️ ล้างข้อมูลทั้งหมด — ยืนยัน?')) return;
  if (!confirm('ข้อมูลที่ยังไม่ Sync จะหายหมด — แน่ใจ?')) return;
  ['products','sales','syncQueue','settings','mgrPin','staff','lastSync','session','pendingStaff']
    .forEach(k=>DB.del(k));
  initDefaultData();
  showToast('✅ ล้างข้อมูลแล้ว','info');
}

// ═══════════════════════════════════════════
//  NETWORK / SYNC
// ═══════════════════════════════════════════
function setupNetwork() {
  window.addEventListener('online',  ()=>{ updateStatusBadge(); showToast('🌐 ออนไลน์แล้ว','info'); setTimeout(()=>syncToSheets(),2000); });
  window.addEventListener('offline', ()=>{ updateStatusBadge(); showToast('📴 ออฟไลน์','info'); });
}
function updateStatusBadge() {
  const el = document.getElementById('statusBadge'); if (!el) return;
  const q = DB.get('syncQueue')||[];
  if (!navigator.onLine) {
    el.className='status-badge badge-offline';
    el.innerHTML=`<div class="status-dot"></div>ออฟไลน์${q.length>0?` (${q.length})`:''}`;
  } else {
    el.className='status-badge badge-online';
    el.innerHTML='<div class="status-dot"></div>ออนไลน์';
  }
}
// ── Sync timer (heartbeat flush)
let _syncInProgress = false;
let _syncRetryTimer = null;

function setupSyncTimer() {
  if (_syncTimer) clearInterval(_syncTimer);
  // heartbeat ทุก 5 นาที
  _syncTimer = setInterval(() => {
    if (navigator.onLine && !_syncInProgress) flushSyncQueue();
  }, 5 * 60 * 1000);
}

function renderSyncChip() {
  const el = document.getElementById('syncChip'); if (!el) return;
  const q = DB.get('syncQueue') || [];
  if (q.length > 0) {
    el.textContent = `⏳ รอ ${q.length}`;
    el.className = 'sync-chip badge-yellow';
  } else {
    el.textContent = '✓ Sync';
    el.className = 'sync-chip badge-green';
  }
}

// เพิ่มเข้า queue แล้ว trigger ทันที
function addToSyncQueue(item) {
  const q = DB.get('syncQueue') || [];
  q.push(item);
  DB.set('syncQueue', q);
  renderSyncChip();
  if (navigator.onLine) setTimeout(() => flushSyncQueue(), 300);
}

// ส่งแบบทยอย batch
async function flushSyncQueue() {
  if (_syncInProgress) return;
  const s = DB.get('settings') || {};
  const url = s.sheetsUrl || CONFIG.SHEETS_URL;
  if (!url || !navigator.onLine) return;
  const q = DB.get('syncQueue') || [];
  if (q.length === 0) return;
  _syncInProgress = true;
  updateStatusBadge();
  const batch = q.slice(0, 5);
  try {
    const payload = {
      action: 'sync', timestamp: new Date().toISOString(),
      sales: batch.filter(x => !x.type),
      products: DB.get('products') || [],
      staff: (DB.get('session') || {}).name || '—',
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    if (res.ok || res.status === 0) {
      const remaining = q.slice(batch.length);
      DB.set('syncQueue', remaining);
      DB.set('lastSync', new Date().toISOString());
      _syncInProgress = false;
      if (remaining.length > 0) {
        showToast(`✅ Sync ${batch.length} รายการ (เหลือ ${remaining.length})`, 'success');
        setTimeout(() => flushSyncQueue(), 500);
      } else {
        showToast(`✅ Sync เสร็จ ${batch.length} รายการ`, 'success');
      }
    } else { throw new Error('HTTP ' + res.status); }
  } catch (e) {
    console.error('Sync error:', e);
    _syncInProgress = false;
    if (_syncRetryTimer) clearTimeout(_syncRetryTimer);
    _syncRetryTimer = setTimeout(() => { if (navigator.onLine) flushSyncQueue(); }, 30000);
    showToast('⚠️ Sync ไม่สำเร็จ — ลองใหม่ใน 30 วิ', 'error');
  }
  renderSyncChip(); updateStatusBadge();
}

async function syncToSheets(isClose = false) {
  if (!isClose) { flushSyncQueue(); return; }
  // ปิดร้าน — ส่งทั้งหมด
  const s = DB.get('settings') || {};
  const url = s.sheetsUrl || CONFIG.SHEETS_URL;
  if (!url || !navigator.onLine) return;
  const q = DB.get('syncQueue') || [];
  try {
    const payload = { action: 'close_shop', timestamp: new Date().toISOString(), sales: q, products: DB.get('products') || [], staff: (DB.get('session') || {}).name || '—' };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    if (res.ok || res.status === 0) { DB.set('syncQueue', []); DB.set('lastSync', new Date().toISOString()); }
  } catch (e) { console.error('Close sync error:', e); }
}

async function syncFromSheets() {
  const s = DB.get('settings')||{};
  const url = s.sheetsUrl || CONFIG.SHEETS_URL;
  if (!url || !navigator.onLine) { showToast('📴 ใช้ข้อมูลในเครื่อง','info'); return; }
  showToast('🔄 กำลังดึงข้อมูลจาก Sheets...','info');
  try {
    const res = await fetch(url+'?action=get_stock', { method:'GET', redirect:'follow' });
    const text = await res.text();
    const data = JSON.parse(text);
    if (data.ok && data.products) {
      DB.set('products', data.products);
      renderProducts();
      showToast('✅ ดึงสต็อกล่าสุดแล้ว','success');
    }
  } catch(e) { showToast('⚠️ ดึงข้อมูลไม่สำเร็จ — ใช้ข้อมูลในเครื่อง','error'); }
}

function manualSync() {
  if (!navigator.onLine) { showToast('⚠️ ไม่มีอินเตอร์เน็ต', 'error'); return; }
  _syncInProgress = false;
  flushSyncQueue();
}

// ═══════════════════════════════════════════
//  TABS (STOCK / HISTORY / SETTINGS)
// ═══════════════════════════════════════════
function showTab(tab, btn) {
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('act
