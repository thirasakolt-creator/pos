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
  // registerSW ทำงาน background ไม่ block
  registerSW();

  // ── ตรวจว่ามี session ค้างอยู่ไหม ──
  const sess = DB.get('session');
  if (sess && sess.active) {
    enterApp(false);
  } else {
    showScreen('login');
    showLoginStep('step-role');
  }
  _hideLoadingEarly();
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

function _hideLoadingEarly() {
  document.getElementById('loadingOverlay')?.classList.add('hidden');
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
  if (sess.role !== 'mgr') {
    const pin = prompt('🔐 ปิดร้าน — กรอกรหัสผู้จัดการ:');
    if (!pin) return;
    const correct = DB.get('mgrPin') || CONFIG.DEFAULT_MGR_PIN;
    if (pin !== correct) { showToast('❌ รหัสผิด', 'error'); return; }
  }
  showCloseReport();
}

function showCloseReport() {
  const sess    = DB.get('session') || {};
  const sales   = DB.get('sales')   || [];
  const s       = DB.get('settings') || {};
  const today   = new Date().toDateString();
  const todaySales = sales.filter(x => new Date(x.timestamp).toDateString() === today);

  const cashSales = todaySales.filter(x => x.payMethod !== 'qr');
  const qrSales   = todaySales.filter(x => x.payMethod === 'qr');
  const totalSales   = todaySales.reduce((a, x) => a + x.total, 0);
  const totalCash    = cashSales.reduce((a, x) => a + x.total, 0);
  const totalQR      = qrSales.reduce((a, x) => a + x.total, 0);
  const floatAmount  = sess.float || 0;
  const expectedCash = floatAmount + totalCash;
  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' });
  const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;

  document.getElementById('closeReportContent').innerHTML = `
    <div class="report-header">
      <div class="report-shop">${s.shopName || 'ร้านของฉัน'}</div>
      <div class="report-date">รายงานปิดร้าน — ${dateStr} เวลา ${timeStr}</div>
      <div class="report-date" style="margin-top:4px">พนักงาน: ${sess.name || '—'}</div>
    </div>

    <div class="report-section-title">ยอดขายวันนี้</div>
    <div class="report-row"><span>จำนวนบิลทั้งหมด</span><span>${todaySales.length} บิล</span></div>
    <div class="report-row"><span>ยอดขายรวม</span><span style="color:var(--ac)">฿${totalSales.toFixed(2)}</span></div>
    <div class="report-row"><span>เงินสด (${cashSales.length} บิล)</span><span>฿${totalCash.toFixed(2)}</span></div>
    <div class="report-row"><span>QR Code (${qrSales.length} บิล)</span><span style="color:var(--ac3)">฿${totalQR.toFixed(2)}</span></div>

    <div class="report-section-title">สรุปเงินสดในเครื่อง</div>
    <div class="report-row"><span>เงินทอนตั้งต้น</span><span>฿${floatAmount.toFixed(2)}</span></div>
    <div class="report-row"><span>รับเงินสดมา</span><span>฿${totalCash.toFixed(2)}</span></div>

    <div class="report-total-box">
      <div class="report-total-label">เงินสดในเครื่องที่ควรมี</div>
      <div class="report-total-num">฿${expectedCash.toFixed(2)}</div>
    </div>
    <div style="font-size:var(--fs-xs);color:var(--t2);text-align:center;margin-bottom:8px">
      กรุณานับเงินสดให้ตรงกับยอดนี้ก่อนปิดร้าน
    </div>
  `;
  document.getElementById('closeShopReport').style.display = 'flex';
}

async function finalCloseShop() {
  document.getElementById('closeShopReport').style.display = 'none';
  showLoading('กำลังปิดร้านและ Sync...');
  await syncToSheets(true);
  DB.del('session');
  hideLoading();
  showToast('🌙 ปิดร้านเรียบร้อย', 'success');
  setTimeout(() => {
    showScreen('login');
    showLoginStep('step-role');
    document.querySelectorAll('.mgr-tab').forEach(b => b.classList.remove('show'));
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
  if (btn) btn.classList.add('active');
  closeAllTabs();
  if (tab === 'sell') return;
  const el = document.getElementById('tab-'+tab);
  if (!el) return;
  el.style.display = 'flex';
  if (tab==='stock')   { renderStockList(); }
  if (tab==='history') { renderHistory(); }
}

function closeTab(tab) {
  const el = document.getElementById('tab-'+tab);
  if (el) el.style.display = 'none';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  const first = document.getElementById('nav-sell');
  if (first) first.classList.add('active');
}

function closeAllTabs() {
  ['stock','history','settings'].forEach(t=>{
    const el = document.getElementById('tab-'+t);
    if (el) el.style.display = 'none';
  });
}

// ═══════════════════════════════════════════
//  PRODUCTS
// ═══════════════════════════════════════════
let _currentCat = 'all';

function filterCat(cat, el) {
  _currentCat = cat;
  document.querySelectorAll('.cat-tab').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  renderProducts();
}

function renderProducts() {
  const prods = DB.get('products')||[];
  const q = (getValue('searchInput')||'').toLowerCase();
  let list = _currentCat==='all' ? prods : prods.filter(p=>p.cat===_currentCat);
  if (q) list = list.filter(p=>p.name.toLowerCase().includes(q));
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  if (list.length===0) { grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--t3);padding:24px">ไม่พบสินค้า</div>'; return; }
  grid.innerHTML = list.map(p=>{
    const st = p.stock===0?'out':p.stock<=p.minStock?'low':'ok';
    const badge = st==='out'?'<span class="prod-badge badge-red">หมด</span>'
                : st==='low'?'<span class="prod-badge badge-yellow">ใกล้หมด</span>':'';
    return `<div class="product-card${st==='out'?' out-stock':st==='low'?' low-stock':''}" onclick="addToCart(${p.id})">
      ${badge}
      <div class="product-emoji">${p.emoji}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-price">฿${p.price}</div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
//  CART
// ═══════════════════════════════════════════
let _cart = [], _discount = { pct:0, baht:0 };

function addToCart(id) {
  const prods = DB.get('products')||[];
  const p = prods.find(x=>x.id===id);
  if (!p || p.stock===0) return;
  const ex = _cart.find(i=>i.id===id);
  if (ex) { if (ex.qty>=p.stock){showToast('⚠️ สต็อกไม่พอ','error');return;} ex.qty++; }
  else _cart.push({id,name:p.name,price:p.price,qty:1,emoji:p.emoji});
  renderCart();
}

function changeQty(id, d) {
  const item = _cart.find(i=>i.id===id);
  if (!item) return;
  item.qty += d;
  if (item.qty<=0) _cart = _cart.filter(i=>i.id!==id);
  renderCart();
}

function clearCart() { _cart=[]; _discount={pct:0,baht:0}; renderCart(); }

function renderCart() {
  const el = document.getElementById('cartList');
  if (!el) return;
  if (_cart.length===0) {
    el.innerHTML='<div class="cart-empty"><div style="font-size:36px">🛒</div><div>ยังไม่มีสินค้า</div></div>';
  } else {
    el.innerHTML = _cart.map(item=>`
      <div class="cart-item">
        <span class="ci-emoji">${item.emoji}</span>
        <span class="ci-name">${item.name}</span>
        <div class="ci-ctrl">
          <button class="qbtn" onclick="changeQty(${item.id},-1)">−</button>
          <span class="qnum">${item.qty}</span>
          <button class="qbtn" onclick="changeQty(${item.id},1)">+</button>
        </div>
        <span class="ci-price">฿${(item.price*item.qty).toFixed(0)}</span>
      </div>`).join('');
  }
  updateTotals();
}

function getSub()  { return _cart.reduce((s,i)=>s+i.price*i.qty, 0); }
function getDisc() { const sub=getSub(); return _discount.pct>0?sub*_discount.pct/100:Math.min(_discount.baht,sub); }
function getTotal(){ return Math.max(0, getSub()-getDisc()); }
function updateTotals() {
  setText('subtotalDisp', `฿${getSub().toFixed(2)}`);
  setText('discountDisp', `-฿${getDisc().toFixed(2)}`);
  setText('totalDisp',    `฿${getTotal().toFixed(2)}`);
}

// ═══════════════════════════════════════════
//  DISCOUNT
// ═══════════════════════════════════════════
function openDiscount() { openModal('discountModal'); }
function updateDiscount() {
  _discount = { pct:parseFloat(getValue('discountPct'))||0, baht:parseFloat(getValue('discountBaht'))||0 };
  updateTotals();
}

// ═══════════════════════════════════════════
//  CHECKOUT
// ═══════════════════════════════════════════
let _receivedInput = '0';

// ═══════════════════════════════════════════
//  CHECKOUT — Payment method selector
// ═══════════════════════════════════════════
let _payMethod = 'cash';

function openCheckout() {
  if (_cart.length === 0) { showToast('⚠️ ยังไม่มีสินค้า', 'error'); return; }
  const total = getTotal();
  setText('payMethodTotal', `฿${total.toFixed(2)}`);
  openModal('payMethodModal');
}

function selectPayMethod(method) {
  _payMethod = method;
  closeModal('payMethodModal');
  const total = getTotal();
  if (method === 'cash') {
    openCashScreen(total);
  } else {
    openQRScreen(total);
  }
}

function backFromCash() {
  document.getElementById('cashScreen').style.display = 'none';
  openModal('payMethodModal');
}
function backFromQR() {
  document.getElementById('qrScreen').style.display = 'none';
  openModal('payMethodModal');
}

// ── Cash screen ──
function openCashScreen(total) {
  _receivedInput = '0';
  setText('cashTotal', `฿${total.toFixed(2)}`);
  setText('cashReceivedDisplay', '0');
  setText('cashChangeDisp', '฿0.00');
  // Quick amounts
  const rounds = [...new Set([total, Math.ceil(total/50)*50, Math.ceil(total/100)*100, Math.ceil(total/500)*500])].filter(v => v >= total).slice(0, 4);
  const qEl = document.getElementById('cashQuickAmounts');
  if (qEl) qEl.innerHTML = rounds.map(v => `<button class="cash-quick-btn" onclick="setCashReceived(${v})">฿${v.toLocaleString('th')}</button>`).join('');
  document.getElementById('cashScreen').style.display = 'flex';
}

function setCashReceived(val) {
  _receivedInput = val.toString();
  setText('cashReceivedDisplay', val.toLocaleString('th'));
  const change = val - getTotal();
  const el = document.getElementById('cashChangeDisp');
  if (el) { el.textContent = `฿${Math.max(0, change).toFixed(2)}`; el.style.color = change >= 0 ? 'var(--warn)' : 'var(--danger)'; }
}

function numInput(v) {
  if (_receivedInput === '0') _receivedInput = v; else _receivedInput += v;
  if (_receivedInput.length > 8) { _receivedInput = _receivedInput.slice(0, -1); return; }
  const r = parseInt(_receivedInput) || 0;
  setText('cashReceivedDisplay', r.toLocaleString('th'));
  const change = r - getTotal();
  const el = document.getElementById('cashChangeDisp');
  if (el) { el.textContent = `฿${Math.max(0, change).toFixed(2)}`; el.style.color = change >= 0 ? 'var(--warn)' : 'var(--danger)'; }
}
function numDel() {
  _receivedInput = _receivedInput.slice(0, -1) || '0';
  const r = parseInt(_receivedInput) || 0;
  setText('cashReceivedDisplay', r.toLocaleString('th'));
  const el = document.getElementById('cashChangeDisp');
  if (el) el.textContent = `฿${Math.max(0, r - getTotal()).toFixed(2)}`;
}

// ── QR screen ──
function openQRScreen(total) {
  setText('qrTotal', `฿${total.toFixed(2)}`);
  const s = DB.get('settings') || {};
  setText('qrShopName', s.shopName || 'ร้านของฉัน');
  drawQR(total, s.shopName || 'ร้านของฉัน');
  document.getElementById('qrScreen').style.display = 'flex';
}

function drawQR(amount, shopName) {
  const canvas = document.getElementById('qrCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = 220;
  ctx.clearRect(0, 0, size, size);
  // วาด QR จำลอง (pattern สวยงาม)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  // Corner markers
  [[0,0],[0,7],[7,0]].forEach(([cx,cy])=>{
    const px = cx === 7 ? size - 8*9 : 0;
    const py = cy === 7 ? size - 8*9 : 0;
    // outer
    ctx.fillRect(px+9, py+9, 63, 63);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px+18, py+18, 45, 45);
    ctx.fillStyle = '#000';
    ctx.fillRect(px+27, py+27, 27, 27);
  });
  // Data dots (random-looking but deterministic)
  let seed = amount * 1000 + shopName.length;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let r = 0; r < 21; r++) {
    for (let c = 0; c < 21; c++) {
      if ((r < 8 && c < 8) || (r < 8 && c > 12) || (r > 12 && c < 8)) continue;
      if (rand() > 0.5) {
        ctx.fillRect(9 + c * 9.5, 9 + r * 9.5, 8, 8);
      }
    }
  }
  // PromptPay logo placeholder
  ctx.fillStyle = '#1a56db';
  ctx.beginPath();
  ctx.roundRect(size/2 - 22, size/2 - 12, 44, 24, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PromptPay', size/2, size/2 + 4);
}

function completeSale(method) {
  const total = getTotal();
  let received = total;
  if (method === 'cash') {
    received = parseInt(_receivedInput) || 0;
    if (received < total) { showToast('⚠️ รับเงินไม่ครบ', 'error'); return; }
  }
  document.getElementById('cashScreen').style.display = 'none';
  document.getElementById('qrScreen').style.display = 'none';
  const prods = DB.get('products') || [];
  _cart.forEach(item => { const p = prods.find(x => x.id === item.id); if (p) p.stock = Math.max(0, p.stock - item.qty); });
  DB.set('products', prods);
  const sales = DB.get('sales') || [];
  const saleId = 'B' + String(sales.length + 1).padStart(4, '0');
  const sess = DB.get('session') || {};
  const sale = { id:saleId, items:[..._cart], subtotal:getSub(), discount:getDisc(), total, received, change:received-total, payMethod:method||'cash', timestamp:new Date().toISOString(), staff:sess.name||'—', synced:false };
  sales.push(sale);
  DB.set('sales', sales);
  addToSyncQueue(sale);
  showReceiptFull(sale);
  _cart = []; _discount = { pct:0, baht:0 };
  renderProducts(); renderCart();
}

function showReceiptFull(sale) {
  const s = DB.get('settings') || {};
  const d = new Date(sale.timestamp);
  const h = d.getHours().toString().padStart(2,'0');
  const m = d.getMinutes().toString().padStart(2,'0');
  const dateStr = d.toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric' });
  const payLabel = sale.payMethod === 'qr'
    ? '<span class="rcpt-full-paymethod paymethod-qr">QR Code</span>'
    : '<span class="rcpt-full-paymethod paymethod-cash">เงินสด</span>';
  const itemRows = sale.items.map(i =>
    `<div class="rcpt-full-item"><span>${i.emoji} ${i.name} x${i.qty}</span><span>฿${(i.price*i.qty).toFixed(2)}</span></div>`
  ).join('');
  document.getElementById('receiptFull').innerHTML = `
    <div class="rcpt-full-shop">${s.shopName||'ร้านของฉัน'}</div>
    ${s.phone ? `<div class="rcpt-full-phone">${s.phone}</div>` : ''}
    <div class="rcpt-full-meta">${dateStr} ${h}:${m} | ${sale.id}</div>
    <div class="rcpt-full-meta">พนักงาน: ${sale.staff} &nbsp; ${payLabel}</div>
    <div class="rcpt-full-div"></div>
    ${itemRows}
    <div class="rcpt-full-div"></div>
    <div class="rcpt-full-row"><span>ยอดรวม</span><span>฿${sale.subtotal.toFixed(2)}</span></div>
    ${sale.discount>0?`<div class="rcpt-full-row"><span>ส่วนลด</span><span style="color:var(--ac2)">-฿${sale.discount.toFixed(2)}</span></div>`:''}
    <div class="rcpt-full-total"><span>ยอดสุทธิ</span><span>฿${sale.total.toFixed(2)}</span></div>
    <div class="rcpt-full-div"></div>
    <div class="rcpt-full-row"><span>รับเงิน</span><span>฿${sale.received.toFixed(2)}</span></div>
    <div class="rcpt-full-row" style="color:var(--warn)"><span>เงินทอน</span><span>฿${sale.change.toFixed(2)}</span></div>
    <div class="rcpt-full-div"></div>
    <div class="rcpt-full-thanks">🙏 ขอบคุณที่ใช้บริการ</div>
  `;
  document.getElementById('receiptScreen').style.display = 'flex';
}

function closeReceipt() {
  document.getElementById('receiptScreen').style.display = 'none';
}


// ═══════════════════════════════════════════
//  STOCK
// ═══════════════════════════════════════════
function stockTab(tab, el) {
  document.querySelectorAll('#tab-stock .stab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  ['sv-view','sv-receive','sv-count','sv-add'].forEach(id=>{ const e=document.getElementById(id);if(e)e.style.display='none'; });
  const map={view:'sv-view',receive:'sv-receive',count:'sv-count',add:'sv-add'};
  const t=document.getElementById(map[tab]);if(t)t.style.display='block';
  if(tab==='view')    renderStockList();
  if(tab==='receive') renderReceiveList();
  if(tab==='count')   renderCountList();
}

function renderStockList() {
  const prods = DB.get('products')||[];
  const el = document.getElementById('stockList'); if(!el) return;
  if(prods.length===0){el.innerHTML='<div style="text-align:center;color:var(--t2);padding:24px">ยังไม่มีสินค้า</div>';return;}
  el.innerHTML=prods.map(p=>{
    const max=Math.max(p.minStock*4,p.stock,1),pct=Math.min(100,(p.stock/max)*100);
    const col=p.stock===0?'var(--danger)':p.stock<=p.minStock?'var(--warn)':'var(--ac)';
    const badge=p.stock===0?'<span class="badge-red" style="font-size:10px;padding:2px 6px;border-radius:10px">หมด</span>':p.stock<=p.minStock?'<span class="badge-yellow" style="font-size:10px;padding:2px 6px;border-radius:10px">ใกล้หมด</span>':'<span class="badge-green" style="font-size:10px;padding:2px 6px;border-radius:10px">ปกติ</span>';
    return `<div class="stock-item">
      <div class="stock-emoji">${p.emoji}</div>
      <div class="stock-info">
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="stock-name">${p.name}</span>${badge}</div>
        <div class="stock-meta">฿${p.price} · เตือนที่ ${p.minStock}</div>
        <div class="stock-bar"><div class="stock-bar-fill" style="width:${pct}%;background:${col}"></div></div>
      </div>
      <div class="stock-right">
        <div class="stock-qty" style="color:${col}">${p.stock}</div>
        <button class="btn btn-secondary btn-sm" style="margin-top:4px" onclick="openEditProduct(${p.id})">แก้ไข</button>
      </div>
    </div>`;
  }).join('');
}

function renderReceiveList() {
  const prods = DB.get('products')||[];
  const el=document.getElementById('receiveList');if(!el)return;
  el.innerHTML=prods.map(p=>`<div class="recv-item"><div class="recv-emoji">${p.emoji}</div><div class="recv-info"><div class="recv-name">${p.name}</div><div class="recv-cur">คงเหลือ: <strong>${p.stock}</strong></div></div><input class="recv-input" type="number" id="recv_${p.id}" placeholder="0" min="0"></div>`).join('');
}
function confirmReceive() {
  const prods=DB.get('products')||[]; let n=0;
  prods.forEach(p=>{const q=parseInt(document.getElementById(`recv_${p.id}`)?.value)||0;if(q>0){p.stock+=q;n++;}});
  if(n===0){showToast('⚠️ ยังไม่ได้กรอก','error');return;}
  DB.set('products',prods);addToSyncQueue({type:'receive',products:prods,timestamp:new Date().toISOString()});
  showToast(`✅ รับของเข้า ${n} รายการ`,'success');renderReceiveList();renderStockList();
}

function renderCountList() {
  const prods=DB.get('products')||[];
  const el=document.getElementById('countList');if(!el)return;
  el.innerHTML=prods.map(p=>`<div class="recv-item"><div class="recv-emoji">${p.emoji}</div><div class="recv-info"><div class="recv-name">${p.name}</div><div class="recv-cur">ระบบ: <strong>${p.stock}</strong></div></div><input class="recv-input" type="number" id="count_${p.id}" placeholder="${p.stock}" min="0"></div>`).join('');
}
function confirmCount() {
  const prods=DB.get('products')||[];let n=0;
  prods.forEach(p=>{const v=document.getElementById(`count_${p.id}`)?.value;if(v!==''&&v!==undefined){const q=parseInt(v);if(!isNaN(q)&&q!==p.stock){p.stock=q;n++;}}});
  if(n===0){showToast('ไม่มีการเปลี่ยนแปลง','info');return;}
  DB.set('products',prods);addToSyncQueue({type:'stockCount',products:prods,timestamp:new Date().toISOString()});
  showToast(`✅ อัปเดต ${n} รายการ`,'success');renderCountList();renderStockList();
}

function saveNewProduct() {
  const name=getValue('nProdName'),price=parseFloat(getValue('nProdPrice'));
  if(!name||isNaN(price)){showToast('⚠️ กรอกชื่อและราคา','error');return;}
  const prods=DB.get('products')||[];
  prods.push({id:prods.length>0?Math.max(...prods.map(p=>p.id))+1:1,name,price,cost:parseFloat(getValue('nProdCost'))||0,stock:parseInt(getValue('nProdStock'))||0,minStock:parseInt(getValue('nProdMin'))||5,emoji:getValue('nProdEmoji')||'📦',cat:getValue('nProdCat')||'other'});
  DB.set('products',prods);
  ['nProdName','nProdPrice','nProdCost','nProdStock'].forEach(id=>setValue(id,''));
  showToast('✅ เพิ่มสินค้าแล้ว','success');renderProducts();renderStockList();
}

function openEditProduct(id) {
  const p=(DB.get('products')||[]).find(x=>x.id===id);if(!p)return;
  window._editProdId=id;
  setValue('eProdName',p.name);setValue('eProdPrice',p.price);setValue('eProdCost',p.cost||'');
  setValue('eProdStock',p.stock);setValue('eProdMin',p.minStock);setValue('eProdEmoji',p.emoji);setValue('eProdCat',p.cat);
  openModal('editProductModal');
}
function saveEditProduct() {
  const prods=DB.get('products')||[];const idx=prods.findIndex(p=>p.id===window._editProdId);if(idx===-1)return;
  prods[idx]={...prods[idx],name:getValue('eProdName'),price:parseFloat(getValue('eProdPrice'))||0,cost:parseFloat(getValue('eProdCost'))||0,stock:parseInt(getValue('eProdStock'))||0,minStock:parseInt(getValue('eProdMin'))||5,emoji:getValue('eProdEmoji')||'📦',cat:getValue('eProdCat')};
  DB.set('products',prods);closeModal('editProductModal');showToast('✅ อัปเดตแล้ว','success');renderProducts();renderStockList();
}

// ═══════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════
function renderHistory() {
  const sales=DB.get('sales')||[];
  const today=new Date().toDateString();
  const ts=sales.filter(s=>new Date(s.timestamp).toDateString()===today);
  const tot=ts.reduce((s,x)=>s+x.total,0);
  setText('todaySales',`฿${tot.toLocaleString('th')}`);setText('todayBills',ts.length);
  setText('avgBill',ts.length>0?`฿${(tot/ts.length).toFixed(0)}`:'฿0');
  setText('pendingSync',(DB.get('syncQueue')||[]).length);
  const el=document.getElementById('saleHistory');if(!el)return;
  if(sales.length===0){el.innerHTML='<div style="text-align:center;color:var(--t2);padding:24px">ยังไม่มีประวัติ</div>';return;}
  const q=DB.get('syncQueue')||[];
  el.innerHTML=[...sales].reverse().slice(0,50).map(s=>{
    const d=new Date(s.timestamp);
    const t=`${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    const isSynced=!q.find(x=>x.id===s.id);
    return `<div class="sale-rec"><div class="sale-icon">🧾</div><div class="sale-info"><div class="sale-id">${s.id} · ${s.items.length} รายการ${s.staff?` · ${s.staff}`:''}</div><div class="sale-meta">${d.toLocaleDateString('th-TH',{day:'numeric',month:'short'})} ${t} น. ${isSynced?'<span style="color:var(--ac);font-size:10px">✓</span>':'<span style="color:var(--warn);font-size:10px">⏳</span>'}</div></div><div class="sale-amt">฿${s.total.toFixed(2)}</div></div>`;
  }).join('');
}

// ═══════════════════════════════════════════
//  CLOCK / SW / MODAL / TOAST / HELPERS
// ═══════════════════════════════════════════
function setupClock() {
  const tick=()=>{ const n=new Date();const el=document.getElementById('topbarClock');if(el)el.textContent=`${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}`; };
  tick(); setInterval(tick,30000);
}
async function registerSW() {
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js');
      navigator.serviceWorker.addEventListener('message',e=>{if(e.data?.type==='DO_SYNC')syncToSheets();});
    }catch(e){console.warn('SW:',e.message);}
  }
}
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

function showLoading(msg='กำลังโหลด...') {
  const o=document.getElementById('loadingOverlay'),t=document.getElementById('loadingText');
  if(o)o.classList.remove('hidden');if(t)t.textContent=msg;
}
function hideLoading() { document.getElementById('loadingOverlay')?.classList.add('hidden'); }

let _toastTimer;
function showToast(msg, type='success') {
  const t=document.getElementById('toast');if(!t)return;
  t.textContent=msg;t.className=`toast ${type}`;t.style.display='block';
  clearTimeout(_toastTimer);_toastTimer=setTimeout(()=>{t.style.display='none';},2500);
}

// helpers
const getValue = id => { const e=document.getElementById(id); return e?e.value.trim():''; };
const setValue = (id,v) => { const e=document.getElementById(id); if(e) e.value=v; };
const getText  = id => { const e=document.getElementById(id); return e?e.textContent:''; };
const setText  = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };

// ═══════════════════════════════════════════
//  START
// ═══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', initApp);
