const CFG = window.APP_CONFIG;
const sb = supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

let JOBS = [];
let current = null;
let pendingPhotos = [];

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
  btn.textContent = 'กำลังเข้าสู่ระบบ...'; btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: $('email').value.trim(),
    password: $('password').value
  });
  btn.textContent = 'เข้าสู่ระบบ'; btn.disabled = false;
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
  buildYearOptions();
  loadJobs();
}

/* ---------- ตัวเลือกปี ---------- */
function buildYearOptions() {
  const nowY = new Date().getFullYear();
  let html = '';
  for (let y = nowY; y >= nowY - 6; y--) {
    html += `<option value="${y}">ปี พ.ศ. ${y + 543} (ค.ศ. ${y})</option>`;
  }
  $('yearFilter').innerHTML = html;
}

/* ---------- โหลดข้อมูลทีละหน้า จนครบทั้งปี ---------- */
async function loadJobs() {
  const year = Number($('yearFilter').value);
  $('list').innerHTML = '<div class="empty">กำลังโหลด...</div>';

  const from = `${year}-01-01`;
  const to   = `${year + 1}-01-01`;
  const cols = 'doc_no,sheet_row,reported_date,department,location,description,status,completed_date,main_technician,technician_note,photo_before,photo_after';

  let all = [];
  let page = 0;
  const SIZE = 1000;

  while (true) {
    const { data, error } = await sb
      .from(CFG.TABLE)
      .select(cols)
      .gte('reported_date', from)
      .lt('reported_date', to)
      .order('reported_date', { ascending: false })
      .range(page * SIZE, page * SIZE + SIZE - 1);

    if (error) {
      $('list').innerHTML = '<div class="empty">โหลดไม่สำเร็จ<br>' + error.message + '</div>';
      return;
    }
    all = all.concat(data || []);
    if (!data || data.length < SIZE) break;
    page++;
    if (page > 20) break;
  }

  JOBS = all;
  render();
}

function isDone(s) {
  const t = String(s || '');
  return t.includes('เรียบร้อย') || t.includes('เสร็จ');
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

  const head = `<div class="meta" style="margin-bottom:10px">พบ ${rows.length} งาน (ทั้งปี ${JOBS.length} งาน)</div>`;

  if (!rows.length) {
    $('list').innerHTML = head + '<div class="empty">ไม่พบงานตามเงื่อนไข</div>';
    return;
  }

  $('list').innerHTML = head + rows.map(j => `
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

if ($('search'))     $('search').oninput      = render;
if ($('filter'))     $('filter').onchange     = render;
if ($('yearFilter')) $('yearFilter').onchange = () => loadJobs(false);
if ($('refreshBtn')) $('refreshBtn').onclick  = () => loadJobs(false);

/* ---------- เรียก Apps Script ---------- */
async function callGAS(payload) {
  const res = await fetch(CFG.WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

/* ---------- ย่อรูปก่อนอัปโหลด ---------- */
function compressImage(file, maxSize = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > h && w > maxSize) { h = h * maxSize / w; w = maxSize; }
        else if (h > maxSize)      { w = w * maxSize / h; h = maxSize; }

        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality).split(',')[1]);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------- Modal ---------- */
window.openModal = async function (docNo) {
  current = JOBS.find(j => String(j.doc_no) === String(docNo));
  if (!current) return;
  pendingPhotos = [];

  $('mTitle').textContent = 'อัปเดตงาน #' + current.doc_no;
  $('mSub').textContent = current.location || '';
  $('mStatus').value = current.status || 'ดำเนินการเรียบร้อย';
  $('mDate').value = current.completed_date || new Date().toISOString().slice(0, 10);
  $('mTech').value = current.main_technician || '';
  $('mNote').value = current.technician_note || '';
  $('preview').innerHTML = '';
  $('photoInput').value = '';
  $('modal').classList.remove('hide');

  showDriveImages();
};

/* ---------- แสดงรูปจาก Drive ---------- */
async function showDriveImages() {
  const box = $('driveImages');
  const names = [].concat(current.photo_before || [], current.photo_after || []);
  if (!names.length) { box.innerHTML = '<div class="meta">ไม่มีรูป</div>'; return; }

  box.innerHTML = '<div class="meta">กำลังโหลดรูป...</div>';
  try {
    const r = await callGAS({ action: 'getImages', names: names });
    if (!r.ok || !r.images.length) { box.innerHTML = '<div class="meta">ไม่พบรูปใน Drive</div>'; return; }
    box.innerHTML = r.images.map(im =>
      `<a href="${im.view}" target="_blank"><img src="${im.thumb}" class="thumb" loading="lazy"></a>`
    ).join('');
  } catch (e) {
    box.innerHTML = '<div class="meta">โหลดรูปไม่สำเร็จ</div>';
  }
}

/* ---------- เลือกรูปใหม่ ---------- */
$('photoInput').onchange = async (ev) => {
  const files = Array.from(ev.target.files || []);
  if (!files.length) return;

  $('preview').innerHTML = '<div class="meta">กำลังเตรียมรูป...</div>';
  pendingPhotos = [];

  for (const f of files) {
    const b64 = await compressImage(f);
    pendingPhotos.push({
      base64: b64,
      fileName: `${current.doc_no}_after_${Date.now()}_${pendingPhotos.length + 1}.jpg`,
      mimeType: 'image/jpeg'
    });
  }

  $('preview').innerHTML = pendingPhotos.map(p =>
    `<img src="data:image/jpeg;base64,${p.base64}" class="thumb">`
  ).join('');
};

$('mCancel').onclick = () => $('modal').classList.add('hide');

/* ---------- บันทึก ---------- */
$('mSave').onclick = async () => {
  const btn = $('mSave');
  btn.disabled = true;

  // 1) อัปโหลดรูปขึ้น Drive
  const uploaded = [];
  for (let i = 0; i < pendingPhotos.length; i++) {
    btn.textContent = `กำลังอัปโหลดรูป ${i + 1}/${pendingPhotos.length}...`;
    try {
      const r = await callGAS(Object.assign({ action: 'upload' }, pendingPhotos[i]));
      if (r.ok) uploaded.push(r.file.name);
    } catch (e) {
      toast('อัปโหลดรูปที่ ' + (i + 1) + ' ไม่สำเร็จ');
    }
  }

  btn.textContent = 'กำลังบันทึก...';

  const newAfter = [].concat(current.photo_after || [], uploaded);
  const payload = {
    status: $('mStatus').value,
    completed_date: $('mDate').value || null,
    main_technician: $('mTech').value.trim() || null,
    technician_note: $('mNote').value.trim() || null,
    photo_after: newAfter.length ? newAfter : null,
    updated_at: new Date().toISOString(),
    updated_from: 'pwa'
  };

  // 2) เขียนลง Supabase
  const { error } = await sb.from(CFG.TABLE)
    .update(payload).eq('doc_no', current.doc_no);

  if (error) {
    btn.disabled = false; btn.textContent = 'บันทึก';
    return toast('บันทึกไม่สำเร็จ: ' + error.message);
  }

  // 3) ส่งกลับ Google Sheets
  try {
    await callGAS({
      doc_no: current.doc_no,
      sheet_row: current.sheet_row,
      updates: {
        'ความคืบหน้า': payload.status,
        'วันที่เสร็จ': payload.completed_date,
        'ผู้ซ่อมหลัก': payload.main_technician,
        'คำแนะนำในการดูแลจากซ่าง': payload.technician_note,
        'รูปภาพ (หลังซ่อม)': newAfter.join(' , ')
      }
    });
  } catch (e) {
    toast('บันทึกฐานข้อมูลแล้ว แต่ sync Sheets ไม่สำเร็จ');
  }

  Object.assign(current, payload);
  btn.disabled = false; btn.textContent = 'บันทึก';
  $('modal').classList.add('hide');
  render();
  toast('บันทึกเรียบร้อย ✅');
};

boot();
