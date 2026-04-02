// =====================================================================
// POS Pro v2 — Split Layout + Manager/Staff Login + Float Count
// =====================================================================

const CONFIG = {
  SHEETS_URL: '',
  SYNC_INTERVAL_MS: 60 * 60 * 1000,
  APP_VERSION: '2.0.0',
  DEFAULT_MGR_PIN: '1234',
};

const DB = {
  get: (k) => { try { return JSON.parse(localStorage.getItem('pos2_' + k)); } catch(e) { return null; } },
  set: (k, v) => { try { localStorage.setItem('pos2_' + k, JSON.stringify(v)); return true; } catch(e) { return false; } },
  remove: (k) => localStorage.removeItem('pos2_' + k),
};

const State = {
  cart: [],
  discount: { pct: 0, baht: 0 },
  receivedInput: '0',
  currentCat: 'all',
  isOnline: navigator.onLine,
  isSyncing: false,
  syncTimer: null,
  editingProductId: null,
  currentStaff: null,
  sessionFloat: 0,
  sessionSalesCount: 0,
  mgrPinInput: '',
  staffPinInput: '',
  selectedStaffForLogin: null,
  floatSetByMgr: 0,
  denomCounts: { 1000:0, 500:0, 100:0, 50:0, 20:0, 10:0, 5:0, 1:0 },
};

// ===================== INIT =====================
function initApp() {
  initDefaultData();
  setupNetworkListeners();
  setupClock();
  registerServiceWorker();
  showScreen('login');
  hideLoading();
}

function initDefaultData() {
  if (!DB.get('products')) {
    DB.set('products', [
      { id:1, name:'น้ำดื่ม 600ml', price:7,  stock:48, minStock:10, emoji:'💧', cat:'drink', cost:3 },
      { id:2, name:'โค้ก 325ml',    price:15, stock:24, minStock:6,  emoji:'🥤', cat:'drink', cost:8 },
      { id:3, name:'กาแฟเย็น',      price:35, stock:3,  minStock:5,  emoji:'☕', cat:'drink', cost:15 },
      { id:4, name:'ข้าวผัดหมู',    price:50, stock:8,  minStock:3,  emoji:'🍳', cat:'food',  cost:20 },
      { id:5, name:'ก๋วยเตี๋ยว',    price:45, stock:12, minStock:3,  emoji:'🍜', cat:'food',  cost:18 },
      { id:6, name:'เลย์ 34g',      price:20, stock:36, minStock:10, emoji:'🍟', cat:'snack', cost:10 },
    ]);
  }
  if (!DB.get('sales'))     DB.set('sales', []);
  if (!DB.get('syncQueue')) DB.set('syncQueue', []);
  if (!DB.get('settings'))  DB.set('settings', { shopName:'ร้านของฉัน', phone:'', address:'', sheetsUrl:'' });
  if (!DB.get('mgrPin'))    DB.set('mgrPin', CONFIG.DEFAULT_MGR_PIN);
  if (!DB.get('staff'))     DB.set('staff', [
    { id:'s1', name:'สมชาย ใจดี',   pin:'1111', role:'staff' },
    { id:'s2', name:'สมหญิง รักดี', pin:'2222', role:'staff' },
  ]);
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

// ===================== CLOCK =====================
function setupClock() {
  function tick() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2,'0');
    const m = now.getMinutes().toString().padStart(2,'0');
    const el = document.getElementById('topbarTime');
    if (el) el.textContent = h + ':' + m;
  }
  tick();
  setInterval(tick, 30000);
}

// ===================== LOGIN FLOW =====================
function loginInput(who, digit) {
  if (who === 'mgr') {
    if (State.mgrPinInput.length >= 8) return;
    State.mgrPinInput += digit;
    updatePinDisplay('mgrPinDisplay', State.mgrPinInput.length);
  } else {
    if (State.staffPinInput.length >= 8) return;
    State.staffPinInput += digit;
    updatePinDisplay('staffPinDisplay', State.staffPinInput.length);
  }
}
function loginClear(who) {
  if (who === 'mgr') { State.mgrPinInput = ''; updatePinDisplay('mgrPinDisplay', 0); }
  else               { State.staffPinInput = ''; updatePinDisplay('staffPinDisplay', 0); }
}
function loginDel(who) {
  if (who === 'mgr') { State.mgrPinInput = State.mgrPinInput.slice(0,-1); updatePinDisplay('mgrPinDisplay', State.mgrPinInput.length); }
  else               { State.staffPinInput = State.staffPinInput.slice(0,-1); updatePinDisplay('staffPinDisplay', State.staffPinInput.length); }
}
function updatePinDisplay(elId, len) {
  const el = document.getElementById(elId);
  if (!el) return;
  const filled = Array(Math.max(len,6)).fill('•');
  for (let i = 0; i < len; i++) filled[i] = '★';
  el.textContent = filled.slice(0,Math.max(len,6)).join(' ');
}

function confirmMgrPin() {
  const mgrPin = DB.get('mgrPin') || CONFIG.DEFAULT_MGR_PIN;
  if (State.mgrPinInput === mgrPin) {
    const settings = DB.get('settings') || {};
    document.getElementById('mgrNameDisplay').textContent = settings.shopName || 'ผู้จัดการ';
    renderStaffSelectList();
    goLoginStep('step-select-staff');
    State.mgrPinInput = '';
  } else {
    shakePin('mgrPinDisplay');
    State.mgrPinInput = '';
    updatePinDisplay('mgrPinDisplay', 0);
    showToast('❌ รหัสผู้จัดการไม่ถูกต้อง', 'error');
  }
}

function shakePin(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.add('error');
  el.textContent = 'X  X  X';
  setTimeout(() => { el.classList.remove('error'); updatePinDisplay(elId, 0); }, 700);
}

function renderStaffSelectList() {
  const staffList = DB.get('staff') || [];
  const container = document.getElementById('staffSelectList');
  if (!container) return;
  if (staffList.length === 0) {
    container.innerHTML = '<div style="color:var(--text2);text-align:center;padding:16px;font-size:13px;">ยังไม่มีพนักงาน<br>เพิ่มได้ในเมนูตั้งค่า</div>';
    return;
  }
  container.innerHTML = staffList.map(s => `
    <div class="staff-item" id="si_${s.id}" onclick="selectStaff('${s.id}')">
      <div class="staff-item-avatar">${s.name.charAt(0)}</div>
      <div>
        <div class="staff-item-name">${s.name}</div>
        <div class="staff-item-role">${s.role === 'senior' ? '⭐ พนักงานอาวุโส' : '👤 พนักงานขาย'}</div>
      </div>
    </div>`).join('');
}

function selectStaff(id) {
  State.selectedStaffForLogin = id;
  document.querySelectorAll('.staff-item').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById('si_' + id);
  if (el) el.classList.add('selected');
}

function confirmStaffSelect() {
  if (!State.selectedStaffForLogin) { showToast('⚠️ กรุณาเลือกพนักงาน', 'error'); return; }
  const floatAmt = parseFloat(document.getElementById('floatAmount').value) || 0;
  State.floatSetByMgr = floatAmt;
  const staffList = DB.get('staff') || [];
  const staff = staffList.find(s => s.id === State.selectedStaffForLogin);
  document.getElementById('selectedStaffName').textContent = staff ? staff.name : '—';
  State.staffPinInput = '';
  updatePinDisplay('staffPinDisplay', 0);
  goLoginStep('step-staff-pin');
}

function backToMgr() {
  State.mgrPinInput = '';
  updatePinDisplay('mgrPinDisplay', 0);
  goLoginStep('step-mgr');
}

function backToStaffSelect() {
  State.staffPinInput = '';
  goLoginStep('step-select-staff');
}

function confirmStaffPin() {
  const staffList = DB.get('staff') || [];
  const staff = staffList.find(s => s.id === State.selectedStaffForLogin);
  if (!staff) { showToast('❌ ไม่พบข้อมูลพนักงาน', 'error'); return; }
  if (State.staffPinInput === staff.pin) {
    State.currentStaff = staff;
    Object.keys(State.denomCounts).forEach(k => State.denomCounts[k] = 0);
    updateFloatCountUI();
    document.getElementById('floatAmountDisplay').textContent = '฿' + State.floatSetByMgr.toLocaleString('th');
    State.staffPinInput = '';
    goLoginStep('step-count-float');
  } else {
    shakePin('staffPinDisplay');
    State.staffPinInput = '';
    showToast('❌ รหัสพนักงานไม่ถูกต้อง', 'error');
  }
}

function adjDenom(denom, delta) {
  State.denomCounts[denom] = Math.max(0, (State.denomCounts[denom] || 0) + delta);
  updateFloatCountUI();
}

function updateFloatCountUI() {
  let total = 0;
  Object.entries(State.denomCounts).forEach(([d, count]) => {
    const denom = parseInt(d);
    total += denom * count;
    const dEl = document.getElementById('d' + d);
    const tEl = document.getElementById('t' + d);
    if (dEl) dEl.textContent = count;
    if (tEl) tEl.textContent = '฿' + (denom * count).toLocaleString('th');
  });
  const totalEl = document.getElementById('floatCountTotal');
  if (totalEl) totalEl.textContent = '฿' + total.toLocaleString('th');
  const diff = total - State.floatSetByMgr;
  const diffBar = document.getElementById('floatDiffBar');
  if (diffBar) {
    if (diff === 0) {
      diffBar.textContent = '✅ ตรงกันพอดี';
      diffBar.className = 'float-diff-bar ok';
    } else {
      diffBar.textContent = diff > 0 ? `⚠️ มากกว่า ฿${Math.abs(diff).toLocaleString('th')}` : `⚠️ ขาด ฿${Math.abs(diff).toLocaleString('th')}`;
      diffBar.className = 'float-diff-bar warn';
    }
  }
}

function confirmFloat() {
  const counted = Object.entries(State.denomCounts).reduce((s,[d,c]) => s + parseInt(d)*c, 0);
  const diff = counted - State.floatSetByMgr;
  if (Math.abs(diff) > 0) {
    const ok = confirm(`⚠️ จำนวนเงินต่างกัน ฿${Math.abs(diff)} — ยืนยันเข้าระบบต่อไหม?`);
    if (!ok) return;
  }
  State.sessionFloat = counted;
  State.sessionStartTime = new Date();
  State.sessionSalesCount = 0;
  enterApp();
}

function goLoginStep(stepId) {
  document.querySelectorAll('.login-step').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(stepId);
  if (el) el.classList.add('active');
}

// ===================== ENTER APP =====================
function enterApp() {
  showScreen('app');
  const topStaff = document.getElementById('topbarStaff');
  if (topStaff) topStaff.textContent = State.currentStaff?.name || '—';
  const sfEl = document.getElementById('sessionFloat');
  if (sfEl) sfEl.textContent = '฿' + State.sessionFloat.toLocaleString('th');
  updateStatusBadge();
  renderProducts();
  renderCart();
  renderSyncBar();
  const s = DB.get('settings') || {};
  if (s.sheetsUrl) CONFIG.SHEETS_URL = s.sheetsUrl;
  setupSyncTimer();
  setTimeout(() => syncToSheets(), 3000);
}

function lockScreen() {
  State.currentStaff = null;
  State.mgrPinInput = '';
  State.staffPinInput = '';
  State.selectedStaffForLogin = null;
  updatePinDisplay('mgrPinDisplay', 0);
  goLoginStep('step-mgr');
  showScreen('login');
  ['stock','history','settings'].forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.style.display = 'none';
  });
}

// ===================== MANAGER ACCESS GUARD =====================
function requestMgrAccess() {
  const pin = prompt('🔐 กรอกรหัสผู้จัดการ:');
  if (!pin) return false;
  const mgrPin = DB.get('mgrPin') || CONFIG.DEFAULT_MGR_PIN;
  if (pin === mgrPin) return true;
  showToast('❌ รหัสผิด', 'error');
  return false;
}

// ===================== NETWORK =====================
function setupNetworkListeners() {
  window.addEventListener('online', () => {
    State.isOnline = true; updateStatusBadge();
    showToast('🌐 กลับมาออนไลน์', 'info');
    setTimeout(() => syncToSheets(), 2000);
  });
  window.addEventListener('offline', () => {
    State.isOnline = false; updateStatusBadge();
    showToast('📴 ออฟไลน์', 'info');
  });
}

function updateStatusBadge() {
  const badge = document.getElementById('statusBadge');
  if (!badge) return;
  const queue = DB.get('syncQueue') || [];
  if (State.isSyncing) {
    badge.className = 'status-badge badge-syncing';
    badge.innerHTML = '<div class="status-dot pulse"></div>กำลัง Sync...';
  } else if (!State.isOnline) {
    badge.className = 'status-badge badge-offline';
    badge.innerHTML = `<div class="status-dot"></div>ออฟไลน์${queue.length > 0 ? ` (${queue.length})` : ''}`;
  } else {
    badge.className = 'status-badge badge-online';
    badge.innerHTML = '<div class="status-dot"></div>ออนไลน์';
  }
}

// ===================== SYNC =====================
function setupSyncTimer() {
  if (State.syncTimer) clearInterval(State.syncTimer);
  State.syncTimer = setInterval(() => { if (State.isOnline) syncToSheets(); }, CONFIG.SYNC_INTERVAL_MS);
}

async function syncToSheets() {
  const settings = DB.get('settings') || {};
  const url = settings.sheetsUrl || CONFIG.SHEETS_URL;
  if (!url || !State.isOnline || State.isSyncing) return;
  const queue = DB.get('syncQueue') || [];
  if (queue.length === 0) return;
  State.isSyncing = true; updateStatusBadge();
  try {
    const payload = {
      action: 'sync',
      timestamp: new Date().toISOString(),
      sales: queue,
      products: DB.get('products') || [],
      staff: State.currentStaff?.name || '—',
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    if (res.ok || res.status === 0) {
      DB.set('syncQueue', []);
      DB.set('lastSync', new Date().toISOString());
      showToast(`✅ Sync สำเร็จ ${queue.length} รายการ`, 'success');
    } else { throw new Error('HTTP ' + res.status); }
  } catch(e) {
    console.error('Sync error:', e);
    showToast('⚠️ Sync ไม่สำเร็จ จะลองใหม่อัตโนมัติ', 'error');
  }
  State.isSyncing = false; updateStatusBadge(); renderSyncBar();
}

function renderSyncBar() {
  const queue = DB.get('syncQueue') || [];
  const el = document.getElementById('syncBarRight');
  if (!el) return;
  el.innerHTML = queue.length > 0
    ? `<span class="badge badge-yellow" style="font-size:10px">รอ ${queue.length}</span>`
    : '<span class="badge badge-green" style="font-size:10px">✓ Sync</span>';
}

function manualSync() {
  if (!State.isOnline) { showToast('⚠️ ไม่มีอินเตอร์เน็ต', 'error'); return; }
  syncToSheets();
}

function addToSyncQueue(sale) {
  const queue = DB.get('syncQueue') || [];
  queue.push(sale);
  DB.set('syncQueue', queue);
  renderSyncBar();
}

// ===================== CATEGORIES + PRODUCTS =====================
function filterCat(cat, el) {
  State.currentCat = cat;
  document.querySelectorAll('.cat-tab').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderProducts();
}

function renderProducts() {
  const products = DB.get('products') || [];
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
  let filtered = State.currentCat === 'all' ? products : products.filter(p => p.cat === State.currentCat);
  if (search) filtered = filtered.filter(p => p.name.toLowerCase().includes(search));
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  if (filtered.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:24px;font-size:13px;">ไม่พบสินค้า</div>';
    return;
  }
  grid.innerHTML = filtered.map(p => {
    const st = p.stock === 0 ? 'out' : p.stock <= p.minStock ? 'low' : 'ok';
    const badgeHtml = st === 'out' ? '<span class="product-stock-badge badge-out">หมด</span>'
                    : st === 'low' ? '<span class="product-stock-badge badge-low">ใกล้หมด</span>' : '';
    return `<div class="product-card${st === 'out' ? ' out-stock' : st === 'low' ? ' low-stock' : ''}" onclick="addToCart(${p.id})">
      ${badgeHtml}
      <div class="product-emoji">${p.emoji}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-price">฿${p.price}</div>
    </div>`;
  }).join('');
}

// ===================== CART =====================
function addToCart(id) {
  const products = DB.get('products') || [];
  const product = products.find(p => p.id === id);
  if (!product || product.stock === 0) return;
  const existing = State.cart.find(i => i.id === id);
  if (existing) {
    if (existing.qty >= product.stock) { showToast('⚠️ สต็อกไม่พอ', 'error'); return; }
    existing.qty++;
  } else {
    State.cart.push({ id, name: product.name, price: product.price, qty: 1, emoji: product.emoji });
  }
  renderCart();
}

function changeQty(id, delta) {
  const item = State.cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) State.cart = State.cart.filter(i => i.id !== id);
  renderCart();
}

function clearCart() {
  State.cart = [];
  State.discount = { pct:0, baht:0 };
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cartList');
  if (!container) return;
  if (State.cart.length === 0) {
    container.innerHTML = '<div class="cart-empty-state"><div style="font-size:40px;margin-bottom:8px">🛒</div><div>กดสินค้าเพื่อเพิ่มรายการ</div></div>';
  } else {
    container.innerHTML = State.cart.map(item => `
      <div class="cart-item">
        <span class="cart-item-emoji">${item.emoji}</span>
        <span class="cart-item-name">${item.name}</span>
        <div class="cart-item-controls">
          <button class="qty-btn" onclick="changeQty(${item.id},-1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${item.id},1)">+</button>
        </div>
        <span class="cart-item-price">฿${(item.price*item.qty).toFixed(0)}</span>
      </div>`).join('');
  }
  updateTotals();
  const countEl = document.getElementById('sessionSalesCount');
  if (countEl) countEl.textContent = State.cart.reduce((s,i) => s+i.qty, 0) + ' รายการ';
}

function getSubtotal() { return State.cart.reduce((s,i) => s + i.price * i.qty, 0); }
function getDiscountAmt() {
  const sub = getSubtotal();
  if (State.discount.pct > 0) return sub * State.discount.pct / 100;
  return Math.min(State.discount.baht, sub);
}
function getTotal() { return Math.max(0, getSubtotal() - getDiscountAmt()); }

function updateTotals() {
  document.getElementById('subtotalDisp').textContent = `฿${getSubtotal().toFixed(2)}`;
  document.getElementById('discountDisp').textContent = `-฿${getDiscountAmt().toFixed(2)}`;
  document.getElementById('totalDisp').textContent    = `฿${getTotal().toFixed(2)}`;
}

// ===================== DISCOUNT =====================
function openDiscount() { document.getElementById('discountModal').classList.add('open'); }
function updateDiscount() {
  State.discount = {
    pct:  parseFloat(document.getElementById('discountPct').value)  || 0,
    baht: parseFloat(document.getElementById('discountBaht').value) || 0,
  };
  updateTotals();
}

// ===================== CHECKOUT =====================
function openCheckout() {
  if (State.cart.length === 0) { showToast('⚠️ ยังไม่มีสินค้า', 'error'); return; }
  State.receivedInput = '0';
  const total = getTotal();
  document.getElementById('checkoutTotal').textContent = `฿${total.toFixed(2)}`;
  document.getElementById('receivedDisplay').textContent = '0';
  document.getElementById('changeDisp').textContent = '฿0.00';
  const rounds = [...new Set([total, Math.ceil(total/50)*50, Math.ceil(total/100)*100, Math.ceil(total/500)*500])].filter(v => v >= total).slice(0,4);
  document.getElementById('quickAmounts').innerHTML = rounds.map(v =>
    `<button class="quick-amt-btn" onclick="setReceived(${v})">฿${v.toLocaleString('th')}</button>`
  ).join('');
  document.getElementById('checkoutModal').classList.add('open');
}

function setReceived(val) {
  State.receivedInput = val.toString();
  document.getElementById('receivedDisplay').textContent = val.toLocaleString('th');
  const change = val - getTotal();
  const el = document.getElementById('changeDisp');
  el.textContent = `฿${Math.max(0,change).toFixed(2)}`;
  el.style.color = change >= 0 ? 'var(--warn)' : 'var(--danger)';
}

function numInput(val) {
  if (State.receivedInput === '0') State.receivedInput = val;
  else State.receivedInput += val;
  if (State.receivedInput.length > 8) { State.receivedInput = State.receivedInput.slice(0,-1); return; }
  const received = parseInt(State.receivedInput) || 0;
  document.getElementById('receivedDisplay').textContent = received.toLocaleString('th');
  const change = received - getTotal();
  const el = document.getElementById('changeDisp');
  el.textContent = `฿${Math.max(0,change).toFixed(2)}`;
  el.style.color = change >= 0 ? 'var(--warn)' : 'var(--danger)';
}

function numDelete() {
  State.receivedInput = State.receivedInput.slice(0,-1) || '0';
  const received = parseInt(State.receivedInput) || 0;
  document.getElementById('receivedDisplay').textContent = received.toLocaleString('th');
  document.getElementById('changeDisp').textContent = `฿${Math.max(0, received - getTotal()).toFixed(2)}`;
}

function completeSale() {
  const received = parseInt(State.receivedInput) || 0;
  const total = getTotal();
  if (received < total) { showToast('⚠️ รับเงินไม่ครบ', 'error'); return; }
  const products = DB.get('products') || [];
  State.cart.forEach(item => {
    const p = products.find(p => p.id === item.id);
    if (p) p.stock = Math.max(0, p.stock - item.qty);
  });
  DB.set('products', products);
  const sales = DB.get('sales') || [];
  const saleId = 'B' + String(sales.length + 1).padStart(4,'0');
  const sale = {
    id: saleId, items: [...State.cart],
    subtotal: getSubtotal(), discount: getDiscountAmt(),
    total, received, change: received - total,
    timestamp: new Date().toISOString(),
    staff: State.currentStaff?.name || '—', synced: false,
  };
  sales.push(sale);
  DB.set('sales', sales);
  addToSyncQueue(sale);
  State.sessionSalesCount++;
  closeModal('checkoutModal');
  showReceipt(sale);
  State.cart = [];
  State.discount = { pct:0, baht:0 };
  renderProducts(); renderCart();
}

// ===================== RECEIPT =====================
function showReceipt(sale) {
  const settings = DB.get('settings') || {};
  const now = new Date(sale.timestamp);
  const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  const itemRows = sale.items.map(i => `<div class="receipt-line"><span>${i.emoji} ${i.name} x${i.qty}</span><span>฿${(i.price*i.qty).toFixed(2)}</span></div>`).join('');
  document.getElementById('receiptContent').innerHTML = `
    <div class="receipt">
      <div class="receipt-center receipt-big">${settings.shopName || 'ร้านของฉัน'}</div>
      ${settings.phone ? `<div class="receipt-center" style="font-size:11px">${settings.phone}</div>` : ''}
      <div class="receipt-center" style="font-size:10px;margin-bottom:8px;">${now.toLocaleDateString('th-TH')} ${timeStr} | ${sale.id}</div>
      <div class="receipt-center" style="font-size:10px;color:var(--text2);margin-bottom:8px;">พนักงาน: ${sale.staff}</div>
      <div class="receipt-div"></div>${itemRows}<div class="receipt-div"></div>
      <div class="receipt-line"><span>ยอดรวม</span><span>฿${sale.subtotal.toFixed(2)}</span></div>
      ${sale.discount > 0 ? `<div class="receipt-line"><span>ส่วนลด</span><span>-฿${sale.discount.toFixed(2)}</span></div>` : ''}
      <div class="receipt-line receipt-big"><span>ยอดสุทธิ</span><span>฿${sale.total.toFixed(2)}</span></div>
      <div class="receipt-div"></div>
      <div class="receipt-line"><span>รับเงิน</span><span>฿${sale.received.toFixed(2)}</span></div>
      <div class="receipt-line"><span>เงินทอน</span><span>฿${sale.change.toFixed(2)}</span></div>
      <div class="receipt-div"></div>
      <div class="receipt-center" style="font-size:10px">ขอบคุณที่ใช้บริการ 🙏</div>
    </div>`;
  document.getElementById('receiptModal').classList.add('open');
}

// ===================== NAVIGATION =====================
function gotoPage(page, btn) {
  if (page === 'stock' || page === 'settings') {
    if (!requestMgrAccess()) return;
  }
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ['stock','history','settings'].forEach(p => {
    const el = document.getElementById('page-' + p);
    if (el) el.style.display = 'none';
  });
  if (page !== 'sell') {
    const el = document.getElementById('page-' + page);
    if (el) el.style.display = 'flex';
    if (page === 'stock')    renderStockList();
    if (page === 'history')  renderHistory();
    if (page === 'settings') renderSettingsPage();
  }
}

function closePage(page) {
  const el = document.getElementById('page-' + page);
  if (el) el.style.display = 'none';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const first = document.querySelector('.nav-btn');
  if (first) first.classList.add('active');
}

// ===================== STOCK =====================
function switchStockTab(tab, el) {
  document.querySelectorAll('#page-stock .tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['stockView','stockReceive','stockCount','stockAdd'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  });
  const map = { view:'stockView', receive:'stockReceive', count:'stockCount', add:'stockAdd' };
  const target = document.getElementById(map[tab]);
  if (target) target.style.display = 'block';
  if (tab === 'receive') renderReceiveList();
  if (tab === 'count')   renderCountList();
  if (tab === 'view')    renderStockList();
}

function renderStockList() {
  const products = DB.get('products') || [];
  const container = document.getElementById('stockList');
  if (!container) return;
  if (products.length === 0) { container.innerHTML = '<div style="text-align:center;color:var(--text2);padding:24px;">ยังไม่มีสินค้า</div>'; return; }
  container.innerHTML = products.map(p => {
    const max = Math.max(p.minStock * 4, p.stock, 1);
    const pct = Math.min(100, (p.stock / max) * 100);
    const color = p.stock === 0 ? 'var(--danger)' : p.stock <= p.minStock ? 'var(--warn)' : 'var(--accent)';
    const badge = p.stock === 0 ? '<span class="badge badge-red">หมด</span>' : p.stock <= p.minStock ? '<span class="badge badge-yellow">ใกล้หมด</span>' : '<span class="badge badge-green">ปกติ</span>';
    return `<div class="stock-item">
      <div class="stock-emoji">${p.emoji}</div>
      <div class="stock-info">
        <div class="flex-between"><span class="stock-name">${p.name}</span>${badge}</div>
        <div class="stock-meta">฿${p.price} · เตือนที่ ${p.minStock}</div>
        <div class="stock-bar"><div class="stock-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>
      <div class="stock-right">
        <div class="stock-qty" style="color:${color}">${p.stock}</div>
        <button class="btn btn-secondary btn-sm" onclick="openEditProduct(${p.id})">แก้ไข</button>
      </div>
    </div>`;
  }).join('');
}

function renderReceiveList() {
  const products = DB.get('products') || [];
  const el = document.getElementById('receiveList');
  if (!el) return;
  el.innerHTML = products.map(p => `
    <div class="receive-item">
      <div class="receive-emoji">${p.emoji}</div>
      <div class="receive-info"><div class="receive-name">${p.name}</div><div class="receive-current">คงเหลือ: <strong>${p.stock}</strong></div></div>
      <input class="receive-input" type="number" id="recv_${p.id}" placeholder="0" min="0">
    </div>`).join('');
}

function confirmReceive() {
  const products = DB.get('products') || [];
  let updated = 0;
  products.forEach(p => {
    const qty = parseInt(document.getElementById(`recv_${p.id}`)?.value) || 0;
    if (qty > 0) { p.stock += qty; updated++; }
  });
  if (updated === 0) { showToast('⚠️ ยังไม่ได้กรอกจำนวน', 'error'); return; }
  DB.set('products', products);
  addToSyncQueue({ type:'receive', products, timestamp: new Date().toISOString() });
  showToast(`✅ รับของเข้า ${updated} รายการ`, 'success');
  renderReceiveList(); renderStockList();
}

function renderCountList() {
  const products = DB.get('products') || [];
  const el = document.getElementById('countList');
  if (!el) return;
  el.innerHTML = products.map(p => `
    <div class="receive-item">
      <div class="receive-emoji">${p.emoji}</div>
      <div class="receive-info"><div class="receive-name">${p.name}</div><div class="receive-current">ระบบ: <strong>${p.stock}</strong></div></div>
      <input class="receive-input" type="number" id="count_${p.id}" placeholder="${p.stock}" min="0">
    </div>`).join('');
}

function confirmCount() {
  const products = DB.get('products') || [];
  let updated = 0;
  products.forEach(p => {
    const val = document.getElementById(`count_${p.id}`)?.value;
    if (val !== '' && val !== undefined) {
      const qty = parseInt(val);
      if (!isNaN(qty) && qty !== p.stock) { p.stock = qty; updated++; }
    }
  });
  if (updated === 0) { showToast('ไม่มีการเปลี่ยนแปลง', 'info'); return; }
  DB.set('products', products);
  addToSyncQueue({ type:'stockCount', products, timestamp: new Date().toISOString() });
  showToast(`✅ อัปเดตสต็อก ${updated} รายการ`, 'success');
  renderCountList(); renderStockList();
}

// ===================== PRODUCT EDIT =====================
function saveProduct() {
  const name = document.getElementById('newProdName').value.trim();
  const price = parseFloat(document.getElementById('newProdPrice').value);
  if (!name || isNaN(price)) { showToast('⚠️ กรอกชื่อและราคา', 'error'); return; }
  const products = DB.get('products') || [];
  const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
  products.push({
    id: newId, name, price,
    cost:     parseFloat(document.getElementById('newProdCost').value)  || 0,
    stock:    parseInt(document.getElementById('newProdStock').value)   || 0,
    minStock: parseInt(document.getElementById('newProdMin').value)     || 5,
    emoji:    document.getElementById('newProdEmoji').value.trim()      || '📦',
    cat:      document.getElementById('newProdCat').value,
  });
  DB.set('products', products);
  ['newProdName','newProdPrice','newProdCost','newProdStock'].forEach(id => { const e = document.getElementById(id); if(e) e.value=''; });
  showToast('✅ เพิ่มสินค้าแล้ว', 'success');
  renderProducts(); renderStockList();
}

function openEditProduct(id) {
  const p = (DB.get('products') || []).find(x => x.id === id);
  if (!p) return;
  State.editingProductId = id;
  document.getElementById('editProdName').value  = p.name;
  document.getElementById('editProdPrice').value = p.price;
  document.getElementById('editProdCost').value  = p.cost || '';
  document.getElementById('editProdStock').value = p.stock;
  document.getElementById('editProdMin').value   = p.minStock;
  document.getElementById('editProdEmoji').value = p.emoji;
  document.getElementById('editProdCat').value   = p.cat;
  document.getElementById('editProductModal').classList.add('open');
}

function saveEditProduct() {
  const products = DB.get('products') || [];
  const idx = products.findIndex(p => p.id === State.editingProductId);
  if (idx === -1) return;
  products[idx] = {
    ...products[idx],
    name:     document.getElementById('editProdName').value.trim(),
    price:    parseFloat(document.getElementById('editProdPrice').value)  || 0,
    cost:     parseFloat(document.getElementById('editProdCost').value)   || 0,
    stock:    parseInt(document.getElementById('editProdStock').value)    || 0,
    minStock: parseInt(document.getElementById('editProdMin').value)      || 5,
    emoji:    document.getElementById('editProdEmoji').value.trim()       || '📦',
    cat:      document.getElementById('editProdCat').value,
  };
  DB.set('products', products);
  closeModal('editProductModal');
  showToast('✅ อัปเดตสินค้าแล้ว', 'success');
  renderProducts(); renderStockList();
}

// ===================== HISTORY =====================
function renderHistory() {
  const sales = DB.get('sales') || [];
  const today = new Date().toDateString();
  const todaySales = sales.filter(s => new Date(s.timestamp).toDateString() === today);
  const todayTotal = todaySales.reduce((s, sale) => s + sale.total, 0);
  const setEl = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  setEl('todaySales', `฿${todayTotal.toLocaleString('th')}`);
  setEl('todayBills', todaySales.length);
  setEl('avgBill', todaySales.length > 0 ? `฿${(todayTotal/todaySales.length).toFixed(0)}` : '฿0');
  setEl('pendingSync', (DB.get('syncQueue') || []).length);
  const container = document.getElementById('saleHistory');
  if (!container) return;
  if (sales.length === 0) { container.innerHTML = '<div style="text-align:center;color:var(--text2);padding:24px;">ยังไม่มีประวัติ</div>'; return; }
  const queue = DB.get('syncQueue') || [];
  container.innerHTML = [...sales].reverse().slice(0,50).map(s => {
    const d = new Date(s.timestamp);
    const timeStr = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    const dateStr = d.toLocaleDateString('th-TH', { day:'numeric', month:'short' });
    const isSynced = !queue.find(q => q.id === s.id);
    return `<div class="sale-record">
      <div class="sale-icon">🧾</div>
      <div class="sale-info">
        <div class="sale-id">${s.id} · ${s.items.length} รายการ${s.staff ? ` · ${s.staff}` : ''}</div>
        <div class="sale-meta">${dateStr} ${timeStr} น. ${isSynced ? '<span style="color:var(--accent);font-size:10px">✓ Synced</span>' : '<span style="color:var(--warn);font-size:10px">⏳ รอ</span>'}</div>
      </div>
      <div class="sale-amount">฿${s.total.toFixed(2)}</div>
    </div>`;
  }).join('');
}

// ===================== SETTINGS =====================
function switchSettingsTab(tab, el) {
  document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  ['stab-shop','stab-staff','stab-sync'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  });
  const target = document.getElementById('stab-' + tab);
  if (target) target.style.display = 'block';
  if (tab === 'staff') renderStaffAdmin();
  if (tab === 'sync')  renderSyncSettings();
}

function renderSettingsPage() {
  const s = DB.get('settings') || {};
  const setVal = (id, v) => { const e = document.getElementById(id); if(e) e.value = v; };
  setVal('shopName',  s.shopName  || '');
  setVal('shopPhone', s.phone     || '');
  setVal('shopAddr',  s.address   || '');
  setVal('sheetsUrl', s.sheetsUrl || '');
  ['stab-shop','stab-staff','stab-sync'].forEach((id,i) => {
    const e = document.getElementById(id);
    if (e) e.style.display = i === 0 ? 'block' : 'none';
  });
  document.querySelectorAll('.stab').forEach((b,i) => b.classList.toggle('active', i===0));
}

function saveSettings() {
  const getVal = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
  const s = { shopName: getVal('shopName') || 'ร้านของฉัน', phone: getVal('shopPhone'), address: getVal('shopAddr'), sheetsUrl: getVal('sheetsUrl') };
  DB.set('settings', s);
  if (s.sheetsUrl) CONFIG.SHEETS_URL = s.sheetsUrl;
  showToast('✅ บันทึกการตั้งค่าแล้ว', 'success');
}

function saveMgrPin() {
  const pin = document.getElementById('mgrPinInput')?.value.trim();
  if (!pin || pin.length < 4) { showToast('⚠️ PIN ต้องมีอย่างน้อย 4 หลัก', 'error'); return; }
  DB.set('mgrPin', pin);
  document.getElementById('mgrPinInput').value = '';
  showToast('✅ เปลี่ยนรหัส ผจก แล้ว', 'success');
}

function renderSyncSettings() {
  const queue = DB.get('syncQueue') || [];
  const setEl = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  setEl('queueCount', queue.length);
  setEl('lastSyncDisplay', DB.get('lastSync') ? new Date(DB.get('lastSync')).toLocaleString('th-TH') : 'ยังไม่เคย');
}

// ===================== STAFF MANAGEMENT =====================
function renderStaffAdmin() {
  const staffList = DB.get('staff') || [];
  const container = document.getElementById('staffListAdmin');
  if (!container) return;
  if (staffList.length === 0) { container.innerHTML = '<div style="color:var(--text2);text-align:center;padding:16px;">ยังไม่มีพนักงาน</div>'; return; }
  container.innerHTML = staffList.map(s => `
    <div class="staff-admin-item">
      <div class="staff-item-avatar" style="width:32px;height:32px;font-size:13px">${s.name.charAt(0)}</div>
      <div style="flex:1">
        <div class="staff-admin-name">${s.name}</div>
        <div class="staff-admin-role">${s.role === 'senior' ? '⭐ อาวุโส' : '👤 พนักงาน'} · PIN: ${'•'.repeat(s.pin.length)}</div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="deleteStaff('${s.id}')">ลบ</button>
    </div>`).join('');
}

function openAddStaff() {
  const n = document.getElementById('newStaffName'); if(n) n.value='';
  const p = document.getElementById('newStaffPin');  if(p) p.value='';
  document.getElementById('addStaffModal').classList.add('open');
}

function saveNewStaff() {
  const name = document.getElementById('newStaffName')?.value.trim();
  const pin  = document.getElementById('newStaffPin')?.value.trim();
  const role = document.getElementById('newStaffRole')?.value || 'staff';
  if (!name || !pin || pin.length < 4) { showToast('⚠️ กรอกชื่อและ PIN อย่างน้อย 4 หลัก', 'error'); return; }
  const staffList = DB.get('staff') || [];
  staffList.push({ id: 's' + Date.now(), name, pin, role });
  DB.set('staff', staffList);
  closeModal('addStaffModal');
  renderStaffAdmin();
  showToast(`✅ เพิ่ม ${name} แล้ว`, 'success');
}

function deleteStaff(id) {
  if (!confirm('ลบพนักงานคนนี้?')) return;
  DB.set('staff', (DB.get('staff') || []).filter(s => s.id !== id));
  renderStaffAdmin();
  showToast('✅ ลบพนักงานแล้ว', 'success');
}

// ===================== SERVICE WORKER =====================
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'DO_SYNC') syncToSheets();
      });
    } catch(e) { console.warn('SW not available:', e.message); }
  }
}

// ===================== CLEAR DATA =====================
function clearAllData() {
  if (!confirm('⚠️ ล้างข้อมูลทั้งหมด?')) return;
  if (!confirm('ข้อมูลที่ยังไม่ Sync จะหาย — แน่ใจไหม?')) return;
  ['products','sales','syncQueue','settings','mgrPin','staff','lastSync'].forEach(k => DB.remove(k));
  initDefaultData();
  showToast('✅ ล้างข้อมูลแล้ว', 'info');
}

// ===================== MODALS + TOAST =====================
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2500);
}

// ===================== START =====================
window.addEventListener('DOMContentLoaded', initApp);
