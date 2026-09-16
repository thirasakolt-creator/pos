const CFG = window.APP_CONFIG;
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

let JOBS = [];
let current = null;

const $ = (id) => document.getElementById(id);

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ---------- Auth ---------- */
$('loginBtn').onclick = async () => {
  const btn = $('loginBtn');
  btn.textContent = 'กำลังเข้าสู่ระบบ...';
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value
  });
  btn.textContent = 'เข้าสู่ระบบ';
  btn.disabled = false;
  if (error) return toast('เข้าสู่ระบบไม่สำเร็จ: ' + error.message);
  boot();
};

$('logoutBtn').onclick = async () => {
  await sb.auth.signOut();
  $('appView').classList.add('hide');
  $('loginView').classList.remove('hide');
};

async function boot() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    $('loginView').classList.remove('hide');
    $('appView').classList.add('hide');
    return;
  }
  $('loginView').classList.add('hide');
  $('appView').classList.remove('hide');
  loadJobs();
}

/* ---------- Load ---------- */
async function loadJobs() {
  $('list').innerHTML = '<div class="empty">กำลังโหลด...</div>';
  const { data, error } = await sb
    .from(CFG.TABLE)
    .select('doc_no,sheet_row,reported_date,department,location,description,status,completed_date,main_technician,technician_note')
    .order('reported_date', { ascending: false })
    .limit(300);

  if (error) {
    $('list').innerHTML = '<div class="empty">โหลดข้อมูลไม่สำเร็จ<br>' + error.message + '</div>';
    return;
  }
  JOBS = data || [];
  render();
}

function isDone(s) {
  return String(s || '').includes('เรียบร้อย') || String(s || '').includes('เสร็จ');
}

function render() {
  const q = $('search').value.trim().toLowerCase();
  const f = $('filter').value;

  const rows = JOBS.filter(j => {
    if (f === 'open' && isDone(j.status)) return false;
    if (f === 'done' && !isDone(j.status)) return false;
    if (!q) return true;
    return [j.doc_no, j.location, j.description, j.department]
      .join(' ').toLowerCase().includes(q);
  });

  if (!rows.length) {
    $('list').innerHTML = '<div class="empty">ไม่พบงานตามเงื่อนไข</div>';
    return;
  }

  $('list').innerHTML = rows.map(j => `
    <div class="card">
      <span class="badge">${j.status || 'ยังไม่ระบุสถานะ'}</span>
      <h3>#${j.doc_no} · ${j.location || '-'}</h3>
      <div class="meta">
        แผนก: ${j.department || '-'}<br>
        แจ้งเมื่อ: ${j.reported_date || '-'}<br>
        อาการ: ${j.description || '-'}
      </div>
      <div style="height:12px"></div>
      <button class="btn" onclick="openModal('${j.doc_no}')">อัปเดตงาน</button>
    </div>
  `).join('');
}

$('search').oninput = render;
$('filter').onchange = render;
$('refreshBtn').onclick = loadJobs;

/* ---------- Modal ---------- */
window.openModal = function (docNo) {
  current = JOBS.find(j => String(j.doc_no) === String(docNo));
  if (!current) return;
  $('mTitle').textContent = 'อัปเดตงาน #' + current.doc_no;
  $('mSub').textContent = current.location || '';
  $('mStatus').value = current.status || 'ดำเนินการเรียบร้อย';
  $('mDate').value = current.completed_date || new Date().toISOString().slice(0, 10);
  $('mTech').value = current.main_technician || '';
  $('mNote').value = current.technician_note || '';
  $('modal').classList.remove('hide');
};

$('mCancel').onclick = () => $('modal').classList.add('hide');

$('mSave').onclick = async () => {
  const btn = $('mSave');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  const payload = {
    status: $('mStatus').value,
    completed_date: $('mDate').value || null,
    main_technician: $('mTech').value.trim() || null,
    technician_note: $('mNote').value.trim() || null,
    updated_at: new Date().toISOString(),
    updated_from: 'pwa'
  };

  // 1) เขียนลง Supabase
  const { error } = await sb.from(CFG.TABLE)
    .update(payload).eq('doc_no', current.doc_no);

  if (error) {
    btn.disabled = false;
    btn.textContent = 'บันทึก';
    return toast('บันทึกไม่สำเร็จ: ' + error.message);
  }

  // 2) ส่งกลับ Google Sheets
  try {
    await fetch(CFG.WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        doc_no: current.doc_no,
        sheet_row: current.sheet_row,
        updates: {
          'ความคืบหน้า': payload.status,
          'วันที่เสร็จ': payload.completed_date,
          'ผู้ซ่อมหลัก': payload.main_technician,
          'คำแนะนำในการดูแลจากซ่าง': payload.technician_note
        }
      })
    });
  } catch (e) {
    toast('บันทึกลงฐานข้อมูลแล้ว แต่ sync กลับ Sheets ไม่สำเร็จ');
  }

  Object.assign(current, payload);
  btn.disabled = false;
  btn.textContent = 'บันทึก';
  $('modal').classList.add('hide');
  render();
  toast('บันทึกเรียบร้อย ✅');
};

sb.auth.onAuthStateChange(() => {});
boot();
