// =====================================================================
// POS PRO — Offline-First PWA
// Architecture: LocalStorage → background sync → Google Sheets
// =====================================================================

// ===================== CONFIG =====================
const CONFIG = {
  SHEETS_URL: '', // ใส่ URL Apps Script ตรงนี้ หลังตั้งค่า Google Sheets
  SYNC_INTERVAL_MS: 60 * 60 * 1000, // 1 ชั่วโมง
  APP_VERSION: '1.0.0',
};

// ===================== DB (LocalStorage) =====================
const DB = {
  get: (k) => { try { return JSON.parse(localStorage.getItem('pos_' + k)); } catch(e) { return null; } },
  set: (k, v) => { try { localStorage.setItem('pos_' + k, JSON.stringify(v)); return true; } catch(e) { console.error('DB write fail', e); return false; } },
  remove: (k) => localStorage.removeItem('pos_' + k),
};

// ===================== STATE =====================
const State = {
  cart: [],
  discount: { pct: 0, baht: 0 },
  receivedInput: '0',
  currentCat: 'all',
  editingProductId: null,
  currentStockTab: 'view',
  isOnline: navigator.onLine,
  isSyncing: false,
  syncTimer: null,
  isShopOpen: false,
  lastSyncTime: null,
};

// ===================== INIT =====================
function initApp() {
  showLoading('กำลังเริ่มระบบ...');
  initDefaultData();
  registerServiceWorker();
  setupNetworkListeners();
  setupSyncTimer();
  loadSettings();
  renderAll();
  checkShopStatus();
  hideLoading();
}

function initDefaultData() {
  if (!DB.get('products')) {
    DB.set('products', [
      { id: 1, name: 'น้ำดื่ม 600ml', price: 7, stock: 48, minStock: 10, emoji: '💧', cat: 'drink' },
      { id: 2, name: 'โค้ก 325ml', price: 15, stock: 24, minStock: 6, emoji: '🥤', cat: 'drink' },
      { id: 3, name: 'กาแฟเย็น', price: 35, stock: 3, minStock: 5, emoji: '☕', cat: 'drink' },
      { id: 4, name: 'ข้าวผัดหมู', price: 50, stock: 8, minStock: 3, emoji: '🍳', cat: 'food' },
      { id: 5, name: 'ก๋วยเตี๋ยว', price: 45, stock: 12, minStock: 3, emoji: '🍜', cat: 'food' },
      { id: 6, name: 'เลย์ 34g', price: 20, stock: 36, minStock: 10, emoji: '🍟', cat: 'snack' },
    ]);
  }
  if (!DB.get('sales')) DB.set('sales', []);
  if (!DB.get('syncQueue')) DB.set('syncQueue', []);
  if (!DB.get('settings')) DB.set('settings', { shopName: 'ร้านของฉัน', phone: '', address: '', sheetsUrl: '' });
  if (!DB.get('saleHistory7')) DB.set('saleHistory7', [3200, 2800, 4100, 3600, 3900, 2200, 4500]);
}

// ===================== SERVICE WORKER =====================
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered:', reg.scope);
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'DO_SYNC') syncToSheets();
      });
    } catch(e) { console.log('SW failed:', e); }
  }
}

// ===================== NETWORK =====================
function setupNetworkListeners() {
  window.addEventListener('online', () => {
    State.isOnline = true;
    updateStatusBadge();
    showToast('🌐 กลับมาออนไลน์แล้ว', 'info');
    // Auto-sync queued items
    setTimeout(() => syncToSheets(), 2000);
  });
  window.addEventListener('offline', () => {
    State.isOnline = false;
    updateStatusBadge();
    showToast('📴 ออฟไลน์ — บันทึกข้อมูลในเครื่อง', 'info');
  });
}

function updateStatusBadge() {
  const badge = document.getElementById('statusBadge');
  const queue = DB.get('syncQueue') || [];
  if (State.isSyncing) {
    badge.className = 'status-badge badge-syncing';
    badge.innerHTML = '<div class="status-dot pulse"></div>กำลัง Sync...';
  } else if (!State.isOnline) {
    badge.className = 'status-badge badge-offline';
    badge.innerHTML = `<div class="status-dot"></div>ออฟไลน์${queue.length > 0 ? ` (${queue.length} รอ)` : ''}`;
  } else {
    badge.className = 'status-badge badge-online';
    badge.innerHTML = '<div class="status-dot"></div>ออนไลน์';
  }
}

// ===================== SYNC TO GOOGLE SHEETS =====================
function setupSyncTimer() {
  if (State.syncTimer) clearInterval(State.syncTimer);
  State.syncTimer = setInterval(() => {
    if (State.isOnline) syncToSheets();
  }, CONFIG.SYNC_INTERVAL_MS);
}

async function syncToSheets(isClosing = false) {
  const settings = DB.get('settings') || {};
  const url = settings.sheetsUrl || CONFIG.SHEETS_URL;
  if (!url) return; // Not configured yet
  if (!State.isOnline) return;
  if (State.isSyncing) return;

  const queue = DB.get('syncQueue') || [];
  if (queue.length === 0 && !isClosing) return;

  State.isSyncing = true;
  updateStatusBadge();

  try {
    const payload = {
      action: isClosing ? 'close_shop' : 'sync',
      timestamp: new Date().toISOString(),
      sales: queue,
      products: DB.get('products') || [],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      // Clear synced queue
      DB.set('syncQueue', []);
      State.lastSyncTime = new Date();
      DB.set('lastSync', State.lastSyncTime.toISOString());
      showToast(`✅ Sync สำเร็จ ${queue.length} รายการ`, 'success');

      if (isClosing) {
        // Pull fresh stock from Sheets after close
        const data = await res.json();
        if (data.updatedStock) {
          DB.set('products', data.updatedStock);
        }
      }
    } else {
      throw new Error('Sync failed: ' + res.status);
    }
  } catch(e) {
    console.error('Sync error:', e);
    showToast('⚠️ Sync ไม่สำเร็จ จะลองใหม่อัตโนมัติ', 'error');
  }

  State.isSyncing = false;
  updateStatusBadge();
  renderSyncBar();
}

async function syncFromSheets() {
  // Pull stock from Sheets on shop open
  const settings = DB.get('settings') || {};
  const url = settings.sheetsUrl || CONFIG.SHEETS_URL;
  if (!url || !State.isOnline) {
    showToast('📴 ดึงข้อมูลไม่ได้ — ใช้ข้อมูลในเครื่อง', 'info');
    return;
  }

  showLoading('กำลังดึงสต็อกจาก Google Sheets...');
  try {
    const res = await fetch(url + '?action=get_stock', { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      if (data.products) {
        DB.set('products', data.products);
        renderProducts();
        renderStockList();
        showToast('✅ ดึงสต็อกล่าสุดจาก Sheets แล้ว', 'success');
      }
    }
  } catch(e) {
    showToast('⚠️ ดึงข้อมูลไม่สำเร็จ — ใช้ข้อมูลในเครื่อง', 'error');
  }
  hideLoading();
}

function addToSyncQueue(sale) {
  const queue = DB.get('syncQueue') || [];
  queue.push(sale);
  DB.set('syncQueue', queue);
  updateStatusBadge();
  renderSyncBar();
}

// ===================== SHOP OPEN/CLOSE =====================
function checkShopStatus() {
  const today = new Date().toDateString();
  const lastOpen = DB.get('lastOpenDate');
  State.isShopOpen = lastOpen === today;
  renderOpenStatus();
}

function openShop() {
  const today = new Date().toDateString();
  DB.set('lastOpenDate', today);
  State.isShopOpen = true;
  renderOpenStatus();
  showToast('🏪 เปิดร้านแล้ว!', 'success');
  // Pull latest stock from Sheets
  syncFromSheets();
}

async function closeShop() {
  if (!confirm('ยืนยันปิดร้านและอัปโหลดข้อมูลทั้งหมด?')) return;
  showLoading('กำลังปิดร้านและอัปโหลดข้อมูล...');
  await syncToSheets(true);
  DB.remove('lastOpenDate');
  State.isShopOpen = false;
  renderOpenStatus();
  hideLoading();
  showToast('🌙 ปิดร้านและ Sync เสร็จแล้ว', 'success');
  renderHistory();
}

function renderOpenStatus() {
  const banner = document.getElementById('shopBanner');
  const openBtn = document.getElementById('openShopBtn');
  const closeBtn = document.getElementById('closeShopBtn');
  if (State.isShopOpen) {
    banner.className = 'open-banner';
    banner.innerHTML = `<div class="open-banner-title">🏪 ร้านเปิดอยู่</div><div class="open-banner-sub">${new Date().toLocaleDateString('th-TH', {weekday:'long', year:'numeric', month:'long', day:'numeric'})}</div>`;
    openBtn.style.display = 'none';
    closeBtn.style.display = 'flex';
  } else {
    banner.className = 'open-banner';
    banner.style.borderColor = 'rgba(255,204,0,0.3)';
    banner.innerHTML = '<div class="open-banner-title" style="color:var(--warn)">⏸️ ยังไม่ได้เปิดร้าน</div><div class="open-banner-sub">กด "เปิดร้าน" เพื่อดึงสต็อกล่าสุด</div>';
    openBtn.style.display = 'flex';
    closeBtn.style.display = 'none';
  }
}

function renderSyncBar() {
  const queue = DB.get('syncQueue') || [];
  const lastSync = DB.get('lastSync');
  const bar = document.getElementById('syncBar');
  const lastSyncEl = document.getElementById('lastSyncTime');
  bar.innerHTML = queue.length > 0
    ? `<span class="queue-pill">รอ Sync: ${queue.length} รายการ</span>`
    : '<span class="badge badge-green">✓ Sync ล่าสุดแล้ว</span>';
  if (lastSync) {
    const d = new Date(lastSync);
    lastSyncEl.textContent = `Sync ล่าสุด: ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')} น.`;
  } else {
    lastSyncEl.textContent = 'ยังไม่เคย Sync';
  }
}

// ===================== NAVIGATION =====================
function gotoPage(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  btn.classList.add('active');
  if (page === 'stock') renderStockList();
  if (page === 'history') renderHistory();
  if (page === 'forecast') renderForecast();
  if (page === 'settings') renderSettings();
}

// ===================== PRODUCTS =====================
function filterCat(cat, el) {
  State.currentCat = cat;
  document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderProducts();
}

function renderProducts() {
  const products = DB.get('products') || [];
  const filtered = State.currentCat === 'all' ? products : products.filter(p => p.cat === State.currentCat);
  const grid = document.getElementById('productGrid');
  if (filtered.length === 0) {
    grid.innerHTML = '<div style="grid-column:span 3;text-align:center;color:var(--text2);padding:24px;font-size:13px;">ไม่มีสินค้าในหมวดนี้</div>';
    return;
  }
  grid.innerHTML = filtered.map(p => {
    const status = p.stock === 0 ? 'out' : p.stock <= p.minStock ? 'low' : 'ok';
    const cardClass = `product-card${status === 'out' ? ' out-stock' : status === 'low' ? ' low-stock' : ''}`;
    return `<div class="${cardClass}" onclick="addToCart(${p.id})">
      <div class="product-emoji">${p.emoji}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-price">฿${p.price}</div>
      <div class="product-stock-label"><span class="stock-dot dot-${status}"></span>${p.stock === 0 ? 'หมด' : p.stock + ' ชิ้น'}</div>
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
  showToast(`✅ ${product.emoji} ${product.name}`, 'success');
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
  State.discount = { pct: 0, baht: 0 };
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cartItems');
  const countEl = document.getElementById('cartCount');
  const totalItems = State.cart.reduce((s, i) => s + i.qty, 0);
  countEl.textContent = totalItems;
  countEl.style.display = totalItems > 0 ? 'flex' : 'none';

  if (State.cart.length === 0) {
    container.innerHTML = '<div class="cart-empty">ยังไม่มีรายการ — กดสินค้าเพื่อเพิ่ม</div>';
  } else {
    container.innerHTML = State.cart.map(item => `
      <div class="cart-item">
        <span class="item-emoji">${item.emoji}</span>
        <span class="item-name">${item.name}</span>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty(${item.id},-1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${item.id},1)">+</button>
        </div>
        <span class="item-subtotal">฿${(item.price * item.qty).toFixed(2)}</span>
      </div>`).join('');
  }
  updateTotals();
}

function getSubtotal() { return State.cart.reduce((s, i) => s + i.price * i.qty, 0); }
function getDiscountAmt() {
  const sub = getSubtotal();
  if (State.discount.pct > 0) return sub * State.discount.pct / 100;
  return Math.min(State.discount.baht, sub);
}
function getTotal() { return Math.max(0, getSubtotal() - getDiscountAmt()); }

function updateTotals() {
  document.getElementById('subtotalDisp').textContent = `฿${getSubtotal().toFixed(2)}`;
  document.getElementById('discountDisp').textContent = `-฿${getDiscountAmt().toFixed(2)}`;
  document.getElementById('totalDisp').textContent = `฿${getTotal().toFixed(2)}`;
}

// ===================== DISCOUNT =====================
function openDiscount() {
  document.getElementById('discountModal').classList.add('open');
}
function updateDiscount() {
  const pct = parseFloat(document.getElementById('discountPct').value) || 0;
  const baht = parseFloat(document.getElementById('discountBaht').value) || 0;
  State.discount = { pct, baht };
  updateTotals();
}

// ===================== CHECKOUT =====================
function openCheckout() {
  if (State.cart.length === 0) { showToast('⚠️ ยังไม่มีสินค้า', 'error'); return; }
  State.receivedInput = '0';
  document.getElementById('checkoutTotal').textContent = `฿${getTotal().toFixed(2)}`;
  document.getElementById('receivedDisplay').textContent = '0';
  document.getElementById('changeDisp').textContent = '฿0.00';
  document.getElementById('checkoutModal').classList.add('open');
}

function numInput(val) {
  if (State.receivedInput === '0') State.receivedInput = val;
  else State.receivedInput += val;
  if (State.receivedInput.length > 8) return;
  const received = parseInt(State.receivedInput) || 0;
  document.getElementById('receivedDisplay').textContent = received.toLocaleString('th');
  const change = received - getTotal();
  const changeEl = document.getElementById('changeDisp');
  changeEl.textContent = `฿${Math.max(0, change).toFixed(2)}`;
  changeEl.style.color = change >= 0 ? 'var(--warn)' : 'var(--danger)';
}

function numDelete() {
  State.receivedInput = State.receivedInput.slice(0, -1) || '0';
  numInput('');
  State.receivedInput = State.receivedInput || '0';
  const received = parseInt(State.receivedInput) || 0;
  document.getElementById('receivedDisplay').textContent = received.toLocaleString('th');
  const change = received - getTotal();
  document.getElementById('changeDisp').textContent = `฿${Math.max(0, change).toFixed(2)}`;
}

function completeSale() {
  const received = parseInt(State.receivedInput) || 0;
  const total = getTotal();
  if (received < total) { showToast('⚠️ รับเงินไม่ครบ', 'error'); return; }

  // Deduct stock locally
  const products = DB.get('products') || [];
  State.cart.forEach(item => {
    const p = products.find(p => p.id === item.id);
    if (p) p.stock = Math.max(0, p.stock - item.qty);
  });
  DB.set('products', products);

  // Save sale
  const sales = DB.get('sales') || [];
  const saleId = 'B' + String(sales.length + 1).padStart(4, '0');
  const now = new Date();
  const sale = {
    id: saleId,
    items: [...State.cart],
    subtotal: getSubtotal(),
    discount: getDiscountAmt(),
    total,
    received,
    change: received - total,
    timestamp: now.toISOString(),
    synced: false,
  };
  sales.push(sale);
  DB.set('sales', sales);

  // Queue for sync
  addToSyncQueue(sale);

  // Update 7-day history
  const history = DB.get('saleHistory7') || new Array(7).fill(0);
  history[history.length - 1] = (history[history.length - 1] || 0) + total;
  DB.set('saleHistory7', history);

  closeModal('checkoutModal');
  showReceipt(sale);
  renderProducts();
  renderCart();
}

// ===================== RECEIPT =====================
function showReceipt(sale) {
  const settings = DB.get('settings') || {};
  const now = new Date(sale.timestamp);
  const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
  const dateStr = now.toLocaleDateString('th-TH');
  const itemRows = sale.items.map(i =>
    `<div class="receipt-line"><span>${i.emoji} ${i.name} x${i.qty}</span><span>฿${(i.price*i.qty).toFixed(2)}</span></div>`
  ).join('');
  document.getElementById('receiptContent').innerHTML = `
    <div class="receipt">
      <div class="receipt-center receipt-big">${settings.shopName || 'ร้านของฉัน'}</div>
      ${settings.phone ? `<div class="receipt-center" style="font-size:11px">${settings.phone}</div>` : ''}
      <div class="receipt-center" style="font-size:10px;margin-bottom:8px;">${dateStr} ${timeStr} | ${sale.id}</div>
      <div class="receipt-div"></div>
      ${itemRows}
      <div class="receipt-div"></div>
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

// ===================== STOCK =====================
function switchStockTab(tab, el) {
  State.currentStockTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('stockView').style.display = tab === 'view' ? 'block' : 'none';
  document.getElementById('stockReceive').style.display = tab === 'receive' ? 'block' : 'none';
  document.getElementById('stockCount').style.display = tab === 'count' ? 'block' : 'none';
  if (tab === 'receive') renderReceiveList();
  if (tab === 'count') renderCountList();
}

function renderStockList() {
  const products = DB.get('products') || [];
  document.getElementById('stockList').innerHTML = products.length === 0
    ? '<div style="text-align:center;color:var(--text2);padding:24px;">ยังไม่มีสินค้า</div>'
    : products.map(p => {
        const max = Math.max(p.minStock * 4, p.stock, 1);
        const pct = Math.min(100, (p.stock / max) * 100);
        const color = p.stock === 0 ? 'var(--danger)' : p.stock <= p.minStock ? 'var(--warn)' : 'var(--accent)';
        const badge = p.stock === 0 ? '<span class="badge badge-red">หมด</span>' : p.stock <= p.minStock ? '<span class="badge badge-yellow">ใกล้หมด</span>' : '<span class="badge badge-green">ปกติ</span>';
        return `<div class="stock-item">
          <div class="stock-emoji">${p.emoji}</div>
          <div class="stock-info">
            <div class="flex-between"><span class="stock-name">${p.name}</span>${badge}</div>
            <div class="stock-meta">฿${p.price} · เตือนที่ ${p.minStock} ชิ้น</div>
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
  document.getElementById('receiveList').innerHTML = products.map(p => `
    <div class="receive-item">
      <div class="receive-emoji">${p.emoji}</div>
      <div class="receive-info">
        <div class="receive-name">${p.name}</div>
        <div class="receive-current">คงเหลือ: <strong style="color:var(--text)">${p.stock}</strong> ชิ้น</div>
      </div>
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
  addToSyncQueue({ type: 'receive', products, timestamp: new Date().toISOString() });
  showToast(`✅ รับของเข้า ${updated} รายการ`, 'success');
  renderReceiveList();
  renderStockList();
}

function renderCountList() {
  const products = DB.get('products') || [];
  document.getElementById('countList').innerHTML = products.map(p => `
    <div class="receive-item">
      <div class="receive-emoji">${p.emoji}</div>
      <div class="receive-info">
        <div class="receive-name">${p.name}</div>
        <div class="receive-current">ระบบ: <strong style="color:var(--text)">${p.stock}</strong> ชิ้น</div>
      </div>
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
  if (updated === 0) { showToast('ไม่มีรายการเปลี่ยนแปลง', 'info'); return; }
  DB.set('products', products);
  addToSyncQueue({ type: 'stockCount', products, timestamp: new Date().toISOString() });
  showToast(`✅ อัปเดตสต็อก ${updated} รายการ`, 'success');
  renderCountList();
  renderStockList();
}

// ===================== ADD/EDIT PRODUCT =====================
function openAddProduct() {
  State.editingProductId = null;
  document.getElementById('addProductTitle').textContent = '➕ เพิ่มสินค้าใหม่';
  ['newProdName','newProdPrice','newProdStock','newProdCost'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('newProdMin').value = '5';
  document.getElementById('newProdEmoji').value = '📦';
  document.getElementById('newProdCat').value = 'other';
  document.getElementById('addProductModal').classList.add('open');
}

function openEditProduct(id) {
  const products = DB.get('products') || [];
  const p = products.find(x => x.id === id);
  if (!p) return;
  State.editingProductId = id;
  document.getElementById('addProductTitle').textContent = '✏️ แก้ไขสินค้า';
  document.getElementById('newProdName').value = p.name;
  document.getElementById('newProdPrice').value = p.price;
  document.getElementById('newProdStock').value = p.stock;
  document.getElementById('newProdMin').value = p.minStock;
  document.getElementById('newProdEmoji').value = p.emoji;
  document.getElementById('newProdCat').value = p.cat;
  document.getElementById('newProdCost').value = p.cost || '';
  document.getElementById('addProductModal').classList.add('open');
}

function saveProduct() {
  const name = document.getElementById('newProdName').value.trim();
  const price = parseFloat(document.getElementById('newProdPrice').value);
  const stock = parseInt(document.getElementById('newProdStock').value) || 0;
  const minStock = parseInt(document.getElementById('newProdMin').value) || 5;
  const emoji = document.getElementById('newProdEmoji').value.trim() || '📦';
  const cat = document.getElementById('newProdCat').value;
  const cost = parseFloat(document.getElementById('newProdCost').value) || 0;
  if (!name || isNaN(price) || price < 0) { showToast('⚠️ กรอกชื่อและราคาให้ถูกต้อง', 'error'); return; }
  const products = DB.get('products') || [];
  if (State.editingProductId) {
    const idx = products.findIndex(p => p.id === State.editingProductId);
    if (idx !== -1) products[idx] = { ...products[idx], name, price, stock, minStock, emoji, cat, cost };
  } else {
    const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
    products.push({ id: newId, name, price, stock, minStock, emoji, cat, cost });
  }
  DB.set('products', products);
  closeModal('addProductModal');
  renderStockList();
  renderProducts();
  showToast(`✅ ${State.editingProductId ? 'อัปเดต' : 'เพิ่ม'}สินค้าแล้ว`, 'success');
}

// ===================== HISTORY =====================
function renderHistory() {
  const sales = DB.get('sales') || [];
  const today = new Date().toDateString();
  const todaySales = sales.filter(s => new Date(s.timestamp).toDateString() === today);
  const todayTotal = todaySales.reduce((s, sale) => s + sale.total, 0);

  document.getElementById('todaySales').textContent = `฿${todayTotal.toLocaleString('th')}`;
  document.getElementById('todayBills').textContent = todaySales.length;
  document.getElementById('avgBill').textContent = todaySales.length > 0
    ? `฿${(todayTotal / todaySales.length).toFixed(0)}`
    : '฿0';

  const queue = DB.get('syncQueue') || [];
  document.getElementById('pendingSync').textContent = queue.length;

  const container = document.getElementById('saleHistory');
  if (sales.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text2);padding:24px;font-size:13px;">ยังไม่มีประวัติการขาย</div>';
    return;
  }
  const sorted = [...sales].reverse().slice(0, 50);
  container.innerHTML = sorted.map(s => {
    const d = new Date(s.timestamp);
    const timeStr = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    const dateStr = d.toLocaleDateString('th-TH', { day:'numeric', month:'short' });
    const isSynced = !queue.find(q => q.id === s.id);
    return `<div class="sale-record">
      <div class="sale-icon">🧾</div>
      <div class="sale-info">
        <div class="sale-id">${s.id} · ${s.items.length} รายการ</div>
        <div class="sale-meta">${dateStr} ${timeStr} น.</div>
        <div class="sale-sync">${isSynced ? '<span style="color:var(--accent);font-size:10px">✓ Synced</span>' : '<span style="color:var(--warn);font-size:10px">⏳ รอ Sync</span>'}</div>
      </div>
      <div class="sale-amount">฿${s.total.toFixed(2)}</div>
    </div>`;
  }).join('');
}

// ===================== FORECAST =====================
function renderForecast() {
  const history = DB.get('saleHistory7') || [0,0,0,0,0,0,0];
  const avg = history.reduce((a, b) => a + b, 0) / history.length || 0;

  // Simple linear regression for forecast
  const n = history.length;
  const sumX = n * (n - 1) / 2;
  const sumY = history.reduce((a, b) => a + b, 0);
  const sumXY = history.reduce((acc, y, x) => acc + x * y, 0);
  const sumX2 = history.reduce((acc, _, x) => acc + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
  const intercept = (sumY - slope * sumX) / n;
  const forecast = [1, 2, 3].map(i => Math.max(0, Math.round(intercept + slope * (n + i - 1))));

  const maxVal = Math.max(...history, ...forecast, 1);
  const days = ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'];
  const today = new Date().getDay();

  const chartEl = document.getElementById('forecastChart');
  const labelsEl = document.getElementById('chartLabels');

  chartEl.innerHTML = [
    ...history.map((v, i) => {
      const h = Math.round((v / maxVal) * 110) + 'px';
      const dayIdx = (today - (history.length - 1 - i) + 7) % 7;
      return `<div class="chart-bar-wrap">
        <div class="chart-val" style="font-size:9px">${v > 0 ? '฿' + (v/1000).toFixed(1) + 'k' : ''}</div>
        <div class="chart-bar bar-actual" style="height:${h}"></div>
      </div>`;
    }),
    ...forecast.map((v, i) => {
      const h = Math.round((v / maxVal) * 110) + 'px';
      return `<div class="chart-bar-wrap">
        <div class="chart-val" style="font-size:9px;color:var(--accent)">฿${(v/1000).toFixed(1)}k</div>
        <div class="chart-bar bar-forecast" style="height:${h}"></div>
      </div>`;
    }),
  ].join('');

  labelsEl.style.cssText = 'display:flex;gap:5px;padding:0 4px;';
  labelsEl.innerHTML = [
    ...history.map((_, i) => {
      const dayIdx = (today - (history.length - 1 - i) + 7) % 7;
      return `<div style="flex:1;text-align:center;font-size:9px;color:var(--text2)">${days[dayIdx]}</div>`;
    }),
    ...['พ.1', 'พ.2', 'พ.3'].map(d => `<div style="flex:1;text-align:center;font-size:9px;color:var(--accent)">${d}</div>`),
  ].join('');

  document.getElementById('fcTomorrow').textContent = `฿${forecast[0].toLocaleString('th')}`;
  document.getElementById('fcAvg').textContent = `฿${Math.round(avg).toLocaleString('th')}`;
  const trendPct = avg > 0 ? ((slope / avg) * 100).toFixed(1) : '0';
  const trendEl = document.getElementById('fcTrend');
  trendEl.textContent = slope > 0 ? `📈 +${trendPct}%` : slope < 0 ? `📉 ${trendPct}%` : '➡️ คงที่';
  trendEl.className = 'stat-value ' + (slope > 0 ? 'green' : slope < 0 ? 'red' : 'yellow');

  // Low stock products
  const products = DB.get('products') || [];
  const lowStock = products.filter(p => p.stock <= p.minStock);
  document.getElementById('fcLowStock').textContent = lowStock.length > 0 ? `${lowStock.length} ชนิด` : 'ไม่มี';
  document.getElementById('fcLowStock').className = 'stat-value ' + (lowStock.length > 0 ? 'orange' : 'green');

  // Reorder suggestions
  const suggestEl = document.getElementById('reorderSuggestions');
  if (lowStock.length === 0) {
    suggestEl.innerHTML = '<div style="text-align:center;color:var(--text2);padding:16px;font-size:13px;">✅ ทุกอย่างปกติ ไม่ต้องสั่งของเพิ่ม</div>';
  } else {
    suggestEl.innerHTML = lowStock.map(p => {
      const suggest = Math.max(p.minStock * 3, 10);
      return `<div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:22px">${p.emoji}</span>
          <div>
            <div style="font-weight:600;font-size:13px">${p.name}</div>
            <div style="font-size:11px;color:var(--text2)">เหลือ ${p.stock} · ควรสั่ง ${suggest} ชิ้น</div>
          </div>
        </div>
        <span class="${p.stock === 0 ? 'badge badge-red' : 'badge badge-yellow'}">${p.stock === 0 ? 'หมด!' : 'ใกล้หมด'}</span>
      </div>`;
    }).join('');
  }
}

// ===================== SETTINGS =====================
function renderSettings() {
  const s = DB.get('settings') || {};
  document.getElementById('shopName').value = s.shopName || '';
  document.getElementById('shopPhone').value = s.phone || '';
  document.getElementById('shopAddr').value = s.address || '';
  document.getElementById('sheetsUrl').value = s.sheetsUrl || '';
  const queue = DB.get('syncQueue') || [];
  document.getElementById('queueCount').textContent = queue.length;
  document.getElementById('lastSyncDisplay').textContent = DB.get('lastSync')
    ? new Date(DB.get('lastSync')).toLocaleString('th-TH')
    : 'ยังไม่เคย Sync';
}

function saveSettings() {
  const s = {
    shopName: document.getElementById('shopName').value.trim() || 'ร้านของฉัน',
    phone: document.getElementById('shopPhone').value.trim(),
    address: document.getElementById('shopAddr').value.trim(),
    sheetsUrl: document.getElementById('sheetsUrl').value.trim(),
  };
  DB.set('settings', s);
  if (s.sheetsUrl) CONFIG.SHEETS_URL = s.sheetsUrl;
  showToast('✅ บันทึกการตั้งค่าแล้ว', 'success');
}

function manualSync() {
  if (!State.isOnline) { showToast('⚠️ ไม่มีอินเตอร์เน็ต', 'error'); return; }
  syncToSheets();
}

function clearAllData() {
  if (!confirm('⚠️ ล้างข้อมูลทั้งหมดในเครื่อง ยืนยัน?')) return;
  if (!confirm('แน่ใจหรือไม่? ข้อมูลที่ยังไม่ Sync จะหาย')) return;
  ['products','sales','syncQueue','settings','saleHistory7','lastSync','lastOpenDate'].forEach(k => DB.remove(k));
  initDefaultData();
  renderAll();
  showToast('✅ ล้างข้อมูลแล้ว', 'info');
}

// ===================== MODALS =====================
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ===================== TOAST =====================
let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.style.display = 'block';
  t.style.animation = 'toastIn 0.3s ease';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, 2500);
}

// ===================== LOADING =====================
function showLoading(msg = 'กำลังโหลด...') {
  document.getElementById('loadingText').textContent = msg;
  document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

// ===================== RENDER ALL =====================
function renderAll() {
  renderProducts();
  renderCart();
  updateStatusBadge();
  renderSyncBar();
}

// ===================== START =====================
window.addEventListener('DOMContentLoaded', initApp);
