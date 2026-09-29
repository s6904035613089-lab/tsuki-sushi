/* =============================================================
   admin.js — หลังบ้าน: ภาพรวม · เมนู · โต๊ะ · บิล · พนักงาน · ตั้งค่า
   ============================================================= */

const TABS = [
  { id: 'dash',     label: '📊 ภาพรวม' },
  { id: 'menu',     label: '🍣 เมนู' },
  { id: 'bills',    label: '🧾 บิลย้อนหลัง' },
  { id: 'tables',   label: '🪑 โต๊ะ' },
  { id: 'staff',    label: '🧑‍🍳 พนักงาน' },
  { id: 'settings', label: '⚙️ ตั้งค่า' }
];

let A_TAB = 'dash';
let A_MENU = [];
let A_CATS = [];
const IMG_LIB = [
  'salmon-nigiri','tuna-nigiri','hamachi-nigiri','ebi-nigiri','tamago-nigiri','unagi-nigiri','aburi-salmon','engawa-nigiri',
  'california-roll','salmon-roll','spicy-tuna-roll','ebi-tempura-roll','avocado-maki',
  'salmon-sashimi','tuna-sashimi','mixed-sashimi','salmon-don','unagi-don','chirashi-don','tendon',
  'gyoza','ebi-tempura','takoyaki','edamame','agedashi-tofu','karaage',
  'shoyu-ramen','tonkotsu-ramen','nabeyaki-udon','mochi-ice','matcha-lava','dorayaki',
  'green-tea','ramune','yuzu-soda','cola'
].map(n => 'assets/images/menu/' + n + '.svg');

async function adminStart() {
  document.getElementById('tabs').innerHTML = TABS.map(t =>
    `<button class="btn btn-sm" id="tab-${t.id}" onclick="go('${t.id}')">${t.label}</button>`).join('');
  try { [A_MENU, A_CATS] = await Promise.all([API.getMenu({ onlyAvailable: false }), API.getCategories()]); }
  catch (e) { toast('โหลดเมนูไม่สำเร็จ: ' + esc(e.message), 'err'); }
  go('dash');
}

async function go(tab) {
  A_TAB = tab;
  TABS.forEach(t => {
    const b = document.getElementById('tab-' + t.id);
    if (b) b.className = 'btn btn-sm ' + (t.id === tab ? 'btn-ink' : 'btn-outline-t');
  });
  const el = document.getElementById('view');
  el.innerHTML = '<div class="spinner-t"></div>';
  const views = { dash: viewDash, menu: viewMenu, bills: viewBills, tables: viewTables, staff: viewStaff, settings: viewSettings };
  try { el.innerHTML = await (views[tab] || viewDash)(); }
  catch (e) { el.innerHTML = `<div class="alert alert-danger">โหลดไม่สำเร็จ: ${esc(e.message)}</div>`; }
}

const stat = (ico, val, lbl) =>
  `<div class="col-6 col-lg-3"><div class="stat"><div style="font-size:1.4rem">${ico}</div>
   <div class="val">${val}</div><div class="lbl">${lbl}</div></div></div>`;

/* =============================================================
   ภาพรวม
   ============================================================= */
async function viewDash() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const [today, open, daily, top] = await Promise.all([
    API.getSessions({ from: from.toISOString(), status: 'paid', limit: 500 }),
    API.getOpenSessions(),
    API.getDailySales(14),
    API.getTopItems(8)
  ]);
  const revenue = today.reduce((a, s) => a + Number(s.total), 0);
  const guests = today.reduce((a, s) => a + s.guests, 0);
  const avg = today.length ? revenue / today.length : 0;

  const byDay = {}; daily.forEach(r => { byDay[r.day] = Number(r.revenue); });
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')); }
  const max = Math.max(1, ...days.map(d => byDay[d] || 0));

  return `
  <div class="row g-3 mb-4">
    ${stat('💰', money(revenue), 'ยอดขายวันนี้')}
    ${stat('🧾', today.length, 'บิลที่ปิดแล้ว')}
    ${stat('👥', guests, 'จำนวนลูกค้า')}
    ${stat('🪑', open.length, 'โต๊ะที่กำลังใช้')}
  </div>
  <div class="row g-3">
    <div class="col-lg-7">
      <div class="panel mb-3">
        <h6 class="mb-3">ยอดขาย 14 วันล่าสุด · เฉลี่ยต่อบิลวันนี้ ${money(avg)}</h6>
        <div class="d-flex gap-1" style="height:130px">
          ${days.map(d => `<div class="d-flex flex-column justify-content-end align-items-center" style="flex:1" title="${d}: ${money(byDay[d] || 0)}">
            <div style="width:68%;height:${Math.round((byDay[d] || 0) / max * 100)}%;min-height:3px;background:linear-gradient(180deg,#f0484f,#b8202c);border-radius:6px 6px 2px 2px"></div>
            <div class="text-muted-t" style="font-size:.6rem;margin-top:4px">${d.slice(8)}</div></div>`).join('')}
        </div>
      </div>
      <div class="panel">
        <h6 class="mb-3">โต๊ะที่กำลังใช้งาน</h6>
        ${open.length ? open.map(s => `
          <div class="d-flex align-items-center gap-3 py-2 border-bottom" style="border-color:var(--line)!important">
            <b style="font-family:Poppins,sans-serif;min-width:40px">${esc(s.dining_tables?.table_no || '-')}</b>
            <span class="flex-grow-1 small">${esc(s.session_no)} · ${s.guests} ท่าน · ${agoText(s.opened_at)}</span>
            ${statusTag('sessionStatus', s.status)}
            <b>${money(s.total)}</b>
          </div>`).join('') : '<div class="text-muted-t text-center py-3">ยังไม่มีโต๊ะที่เปิดอยู่</div>'}
      </div>
    </div>
    <div class="col-lg-5">
      <div class="panel">
        <h6 class="mb-3">🏆 เมนูขายดี (จากบิลที่ปิดแล้ว)</h6>
        ${top.length ? top.map((t, i) => `
          <div class="d-flex align-items-center gap-2 py-1">
            <span class="text-muted-t" style="width:20px">${i + 1}.</span>
            <span class="flex-grow-1">${esc(t.name)} <span class="text-muted-t" style="font-size:.74rem">${esc(t.code)}</span></span>
            <b>${t.qty_sold}</b><span class="text-muted-t small">จาน</span>
          </div>`).join('') : '<div class="text-muted-t small">ยังไม่มีข้อมูลการขาย</div>'}
      </div>
    </div>
  </div>`;
}

/* =============================================================
   เมนู
   ============================================================= */
async function viewMenu() {
  A_MENU = await API.getMenu({ onlyAvailable: false });
  const rows = A_CATS.map(c => {
    const list = A_MENU.filter(m => m.category_id === c.id);
    if (!list.length) return '';
    return `<tr class="table-light"><td colspan="6" class="fw-semibold">${c.emoji} ${esc(c.name)}</td></tr>` +
      list.map(m => `<tr>
        <td><img src="${esc(m.image_url)}" style="width:44px;height:44px;border-radius:9px;object-fit:cover;background:var(--paper-2)"
             onerror="this.src='assets/images/placeholder.svg'"></td>
        <td><div style="font-weight:500">${esc(m.name)}</div>
            <div class="text-muted-t" style="font-size:.74rem">${esc(m.code)} · ${esc(m.name_en || '')}</div></td>
        <td class="fw-semibold">${money(m.price)}<div class="text-muted-t" style="font-size:.72rem">ทุน ${money(m.cost)}</div></td>
        <td>${m.is_popular ? '<span class="tag tag-gold">⭐</span> ' : ''}${m.is_raw ? '<span class="tag tag-raw">ดิบ</span> ' : ''}${m.is_spicy ? '<span class="tag tag-spicy">เผ็ด</span>' : ''}</td>
        <td><div class="form-check form-switch mb-0">
              <input class="form-check-input" type="checkbox" ${m.available ? 'checked' : ''}
                     onchange="toggleAvail('${m.id}', this.checked)"></div></td>
        <td class="text-end text-nowrap">
          <button class="btn btn-ghost btn-sm" onclick="editItem('${m.id}')">แก้ไข</button>
          <button class="btn btn-ghost btn-sm text-danger" onclick="delItem('${m.id}')">ลบ</button>
        </td></tr>`).join('');
  }).join('');

  return `
  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
    <div><h4 class="mb-1">เมนูอาหาร</h4>
      <p class="text-muted-t small mb-0">${A_MENU.length} รายการ · ปิดสวิตช์เพื่อแจ้งว่าของหมด (เมนูจะเทาในหน้าลูกค้าทันที)</p></div>
    <button class="btn btn-red" onclick="editItem()">+ เพิ่มเมนู</button>
  </div>
  <div class="panel"><div class="table-responsive"><table class="table align-middle mb-0">
    <thead><tr><th>รูป</th><th>ชื่อ</th><th>ราคา</th><th>ป้าย</th><th>เปิดขาย</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table></div></div>`;
}

function editItem(id) {
  const m = A_MENU.find(x => x.id === id) || {
    id: '', code: '', name: '', name_en: '', category_id: A_CATS[0]?.id, price: 0, cost: 0,
    image_url: IMG_LIB[0], description: '', prep_minutes: 10,
    is_raw: false, is_spicy: false, is_popular: false, available: true
  };
  document.getElementById('imTitle').textContent = id ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่';
  document.getElementById('catSelect').innerHTML = A_CATS.map(c =>
    `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  const f = document.getElementById('itemForm');
  f.id.value = m.id; f.code.value = m.code; f.name.value = m.name; f.name_en.value = m.name_en || '';
  f.category_id.value = m.category_id || ''; f.price.value = m.price; f.cost.value = m.cost;
  f.prep_minutes.value = m.prep_minutes; f.description.value = m.description || '';
  f.is_popular.checked = !!m.is_popular; f.is_raw.checked = !!m.is_raw;
  f.is_spicy.checked = !!m.is_spicy; f.available.checked = m.available !== false;
  setImg(m.image_url);
  document.getElementById('imgPicker').innerHTML = IMG_LIB.map(src =>
    `<img src="${src}" onclick="setImg('${src}')" title="${src.split('/').pop()}"
      style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid transparent">`).join('');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('itemModal')).show();
}

function setImg(src) {
  document.getElementById('itemForm').image_url.value = src;
  document.getElementById('imgPreview').src = src;
  document.querySelectorAll('#imgPicker img').forEach(i =>
    i.style.borderColor = i.getAttribute('src') === src ? 'var(--red)' : 'transparent');
}

function uploadImg(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900, scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(async blob => {
        try {
          toast('กำลังอัปโหลด…');
          setImg(await API.uploadMenuImage(blob, file.name.replace(/\.[^.]+$/, '') + '.jpg'));
          toast('อัปโหลดรูปแล้ว ✅', 'ok');
        } catch (e) { toast('อัปโหลดไม่สำเร็จ: ' + esc(e.message), 'err'); }
        input.value = '';
      }, 'image/jpeg', 0.86);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveItem(e) {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  try {
    await API.saveMenuItem({
      id: f.id.value || null, code: f.code.value, name: f.name.value, name_en: f.name_en.value,
      category_id: f.category_id.value, price: f.price.value, cost: f.cost.value,
      image_url: f.image_url.value, description: f.description.value, prep_minutes: f.prep_minutes.value,
      is_popular: f.is_popular.checked, is_raw: f.is_raw.checked, is_spicy: f.is_spicy.checked,
      available: f.available.checked
    });
    bootstrap.Modal.getInstance(document.getElementById('itemModal')).hide();
    toast('บันทึกเมนูแล้ว 💾', 'ok');
    go('menu');
  } catch (ex) {
    toast(/duplicate key/.test(ex.message) ? 'รหัสเมนูซ้ำ' : esc(ex.message), 'err');
  } finally { btn.disabled = false; btn.textContent = 'บันทึก'; }
}

async function toggleAvail(id, v) {
  try { await API.setAvailable(id, v); toast(v ? 'เปิดขายแล้ว' : 'แจ้งของหมดแล้ว', 'ok', 1400); }
  catch (e) { toast(esc(e.message), 'err'); }
}

async function delItem(id) {
  const m = A_MENU.find(x => x.id === id);
  if (!confirm('ลบเมนู "' + (m?.name || '') + '" ?\n(ถ้าเคยขายแล้วแนะนำให้ปิดสวิตช์เปิดขายแทน)')) return;
  try { await API.deleteMenuItem(id); toast('ลบแล้ว', 'ok'); go('menu'); }
  catch (e) { toast(esc(e.message), 'err'); }
}

/* =============================================================
   บิลย้อนหลัง
   ============================================================= */
let B_RANGE = 'today';
async function viewBills() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  if (B_RANGE === 'week') from.setDate(from.getDate() - 6);
  if (B_RANGE === 'month') from.setDate(1);
  const list = await API.getSessions({ from: B_RANGE === 'all' ? null : from.toISOString(), limit: 300 });
  const paid = list.filter(s => s.status === 'paid');
  const opt = (v, l) => `<option value="${v}" ${B_RANGE === v ? 'selected' : ''}>${l}</option>`;

  return `
  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
    <div><h4 class="mb-1">บิลย้อนหลัง</h4>
      <p class="text-muted-t small mb-0">${paid.length} บิลที่ปิดแล้ว · รวม <b class="text-red">${money(paid.reduce((a, s) => a + Number(s.total), 0))}</b></p></div>
    <div class="d-flex gap-2">
      <select class="form-select form-select-sm" style="width:130px" onchange="B_RANGE=this.value;go('bills')">
        ${opt('today', 'วันนี้')}${opt('week', '7 วัน')}${opt('month', 'เดือนนี้')}${opt('all', 'ทั้งหมด')}
      </select>
      <button class="btn btn-outline-t btn-sm" onclick="exportBills()">⬇️ CSV</button>
    </div>
  </div>
  <div class="panel"><div class="table-responsive"><table class="table align-middle mb-0">
    <thead><tr><th>เลขที่</th><th>โต๊ะ</th><th>ลูกค้า</th><th>เปิด</th><th>ปิด</th>
      <th class="text-end">ยอดอาหาร</th><th class="text-end">สุทธิ</th><th>สถานะ</th></tr></thead>
    <tbody>${list.map(s => `<tr>
      <td class="fw-semibold">${esc(s.session_no)}</td>
      <td>${esc(s.dining_tables?.table_no || '-')}</td>
      <td>${s.guests} ท่าน</td>
      <td class="small text-muted-t">${fmtDateTime(s.opened_at)}</td>
      <td class="small text-muted-t">${s.closed_at ? fmtTime(s.closed_at) : '–'}</td>
      <td class="text-end">${money(s.subtotal)}</td>
      <td class="text-end fw-semibold text-red">${money(s.total)}</td>
      <td>${statusTag('sessionStatus', s.status)}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="text-center text-muted-t py-4">ไม่มีบิลในช่วงนี้</td></tr>'}</tbody>
  </table></div></div>`;
}

async function exportBills() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  if (B_RANGE === 'week') from.setDate(from.getDate() - 6);
  if (B_RANGE === 'month') from.setDate(1);
  const list = await API.getSessions({ from: B_RANGE === 'all' ? null : from.toISOString(), limit: 1000 });
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['เลขที่บิล', 'โต๊ะ', 'จำนวนลูกค้า', 'เปิดโต๊ะ', 'ปิดบิล', 'ยอดอาหาร', 'Service', 'VAT', 'ส่วนลด', 'สุทธิ', 'สถานะ'];
  const csv = '﻿' + [head.map(q).join(',')].concat(list.map(s => [
    s.session_no, s.dining_tables?.table_no, s.guests, fmtDateTime(s.opened_at),
    s.closed_at ? fmtDateTime(s.closed_at) : '', s.subtotal, s.service_charge, s.vat, s.discount, s.total,
    TS_CONFIG.sessionStatus[s.status]?.label || s.status
  ].map(q).join(','))).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'tsuki-bills-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

/* =============================================================
   โต๊ะ
   ============================================================= */
async function viewTables() {
  const [tables, open] = await Promise.all([API.getTables(), API.getOpenSessions()]);
  const busy = no => open.find(s => s.dining_tables?.table_no === no);
  const zones = [...new Set(tables.map(t => t.zone))];
  return `
  <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
    <div><h4 class="mb-1">โต๊ะในร้าน</h4>
      <p class="text-muted-t small mb-0">${tables.length} โต๊ะ · ใช้งานอยู่ ${open.length} โต๊ะ · เพิ่ม/แก้โต๊ะทำได้ที่ตาราง <code>dining_tables</code> ใน Supabase</p></div>
    <a class="btn btn-red" href="host.html">🪑 ไปหน้าเปิดโต๊ะ</a>
  </div>
  ${zones.map(z => `
    <div class="panel mb-3">
      <h6 class="mb-3">${esc(z)}</h6>
      <div class="table-pick">
        ${tables.filter(t => t.zone === z).map(t => {
          const b = busy(t.table_no);
          return `<div class="table-btn ${b ? 'busy' : ''}">${esc(t.table_no)}
            <small>${b ? b.guests + ' ท่าน · ' + money(b.total) : t.seats + ' ที่นั่ง'}</small></div>`;
        }).join('')}
      </div>
    </div>`).join('')}`;
}

/* =============================================================
   พนักงาน
   ============================================================= */
async function viewStaff() {
  const list = await API.getStaff();
  const me = API.session();
  const roles = { admin: 'แอดมิน (ทุกหน้า)', cashier: 'แคชเชียร์', kitchen: 'ครัว', waiter: 'พนักงานเสิร์ฟ' };
  return `
  <h4 class="mb-1">พนักงาน</h4>
  <p class="text-muted-t small mb-3">เพิ่มบัญชีที่ Supabase → Authentication → Users → <b>Add user</b> แล้วกลับมาตั้งสิทธิ์ที่นี่</p>
  <div class="panel"><div class="table-responsive"><table class="table align-middle mb-0">
    <thead><tr><th>ชื่อ</th><th>อีเมล</th><th>สิทธิ์</th><th>เปิดใช้งาน</th><th>เพิ่มเมื่อ</th></tr></thead>
    <tbody>${list.map(s => `<tr>
      <td><input class="form-control form-control-sm" style="max-width:200px" value="${esc(s.full_name)}"
            onchange="updStaff('${s.id}',{full_name:this.value})"></td>
      <td>${esc(s.email)}${s.id === me.id ? ' <span class="tag tag-new">คุณ</span>' : ''}</td>
      <td><select class="form-select form-select-sm" style="width:170px" ${s.id === me.id ? 'disabled' : ''}
            onchange="updStaff('${s.id}',{role:this.value})">
            ${Object.entries(roles).map(([k, v]) => `<option value="${k}" ${s.role === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select></td>
      <td><div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox"
            ${s.active ? 'checked' : ''} ${s.id === me.id ? 'disabled' : ''}
            onchange="updStaff('${s.id}',{active:this.checked})"></div></td>
      <td class="small text-muted-t">${fmtDateTime(s.created_at)}</td>
    </tr>`).join('')}</tbody></table></div></div>`;
}
async function updStaff(id, patch) {
  try { await API.updateStaff(id, patch); toast('บันทึกแล้ว', 'ok', 1400); }
  catch (e) { toast(esc(e.message), 'err'); }
}

/* =============================================================
   ตั้งค่า + Telegram
   ============================================================= */
const NOTIFY_EVENT = { order: '🍣 ออเดอร์', bill: '💳 เรียกเก็บเงิน', payment: '✅ ชำระเงิน', table: '🪑 เปิดโต๊ะ', test: '🔔 ทดสอบ' };

async function viewSettings() {
  const g = k => esc(API.setting(k, ''));
  let n, log = [], missing = false;
  try { [n, log] = await Promise.all([API.getNotifySettings(), API.getNotificationLog(15)]); }
  catch { missing = true; n = { enabled: false, telegram_bot_token: '', telegram_chat_id: '', notify_order: true, notify_bill: true, notify_payment: true, notify_table: false }; }
  const sw = (name, label, on) => `<div class="form-check form-switch mb-1">
    <input class="form-check-input" type="checkbox" name="${name}" id="n_${name}" ${on ? 'checked' : ''}>
    <label class="form-check-label" for="n_${name}">${label}</label></div>`;

  return `
  <h4 class="mb-1">ตั้งค่าร้าน</h4>
  <p class="text-muted-t small mb-3">ข้อมูลบนใบเสร็จ · Service Charge · VAT</p>
  <form class="row g-3" onsubmit="saveShop(event)">
    <div class="col-lg-7"><div class="panel">
      <h6 class="mb-3">ข้อมูลร้าน</h6>
      <div class="row g-2">
        <div class="col-12"><label class="form-label">ชื่อร้าน</label><input name="shop_name" class="form-control" value="${g('shop_name')}"></div>
        <div class="col-12"><label class="form-label">ที่อยู่</label><input name="shop_address" class="form-control" value="${g('shop_address')}"></div>
        <div class="col-6"><label class="form-label">โทร</label><input name="shop_phone" class="form-control" value="${g('shop_phone')}"></div>
        <div class="col-6"><label class="form-label">เลขผู้เสียภาษี</label><input name="tax_id" class="form-control" value="${g('tax_id')}"></div>
        <div class="col-6"><label class="form-label">พร้อมเพย์</label><input name="promptpay_id" class="form-control" value="${g('promptpay_id')}"></div>
        <div class="col-12"><label class="form-label">ข้อความท้ายใบเสร็จ</label><input name="receipt_footer" class="form-control" value="${g('receipt_footer')}"></div>
      </div>
    </div></div>
    <div class="col-lg-5"><div class="panel">
      <h6 class="mb-3">การคิดเงิน</h6>
      <label class="form-label">Service Charge (%)</label>
      <input name="service_charge_pct" type="number" min="0" max="100" step="0.5" class="form-control mb-2" value="${API.servicePct()}">
      <label class="form-label">VAT (%)</label>
      <input name="vat_pct" type="number" min="0" max="100" step="0.5" class="form-control" value="${API.vatPct()}">
      <div class="small text-muted-t mt-2">VAT คิดจาก (ยอดอาหาร + Service Charge) · ใส่ 0 ถ้าไม่คิด</div>
      <button class="btn btn-red w-100 mt-3">บันทึกการตั้งค่า</button>
    </div></div>
  </form>

  <h4 class="mt-5 mb-1">🔔 แจ้งเตือนผ่าน Telegram</h4>
  <p class="text-muted-t small mb-3">ฐานข้อมูลส่งข้อความเองเมื่อมีออเดอร์ใหม่ ลูกค้าเรียกเก็บเงิน และชำระเงินสำเร็จ</p>
  ${missing ? '<div class="alert alert-warning small">ยังไม่ได้ติดตั้งส่วนแจ้งเตือน — ตรวจว่ารัน <code>supabase/schema.sql</code> ครบแล้ว</div>' : ''}
  <div class="row g-3">
    <div class="col-lg-7"><form class="panel" onsubmit="saveNotify(event)">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h6 class="mb-0">การเชื่อมต่อ</h6>
        <div class="form-check form-switch mb-0">
          <input class="form-check-input" type="checkbox" name="enabled" id="n_enabled" ${n.enabled ? 'checked' : ''}>
          <label class="form-check-label" for="n_enabled">เปิดใช้งาน</label></div>
      </div>
      <label class="form-label">Bot Token</label>
      <div class="input-group mb-2">
        <input name="telegram_bot_token" id="tgToken" class="form-control" type="password" autocomplete="off" value="${esc(n.telegram_bot_token)}" placeholder="123456789:AAxxxx…">
        <button type="button" class="btn btn-outline-t" onclick="const i=document.getElementById('tgToken');i.type=i.type==='password'?'text':'password'">👁️</button>
      </div>
      <label class="form-label">Chat ID</label>
      <div class="input-group mb-2">
        <input name="telegram_chat_id" id="tgChat" class="form-control" value="${esc(n.telegram_chat_id)}" placeholder="เช่น 123456789 หรือ -100… (กลุ่ม)">
        <button type="button" class="btn btn-outline-t" onclick="findChat()">🔍 ค้นหา</button>
      </div>
      <div id="chatList" class="small mb-3"></div>
      <h6 class="mb-2">แจ้งเตือนเมื่อ</h6>
      ${sw('notify_order', '🍣 ลูกค้าสั่งอาหาร (ออเดอร์ใหม่)', n.notify_order)}
      ${sw('notify_bill', '💳 ลูกค้ากดเรียกเก็บเงิน', n.notify_bill)}
      ${sw('notify_payment', '✅ ชำระเงินสำเร็จ / ปิดบิล', n.notify_payment)}
      ${sw('notify_table', '🪑 เปิดโต๊ะใหม่', n.notify_table)}
      <div class="d-flex gap-2 mt-3">
        <button class="btn btn-red flex-fill" ${missing ? 'disabled' : ''}>บันทึก</button>
        <button type="button" class="btn btn-outline-t" id="btnTest" onclick="testTg()" ${missing ? 'disabled' : ''}>📨 ส่งทดสอบ</button>
      </div>
      <div id="tgResult" class="small mt-2"></div>
    </form></div>
    <div class="col-lg-5">
      <div class="panel mb-3">
        <h6 class="mb-2">วิธีตั้งค่า (ครั้งเดียว)</h6>
        <ol class="small mb-0 ps-3" style="line-height:1.8">
          <li>Telegram → ค้นหา <b>@BotFather</b> → <code>/newbot</code> → คัดลอก token</li>
          <li>เปิดแชทกับบอทที่สร้าง แล้วกด <b>Start</b> (หรือเพิ่มบอทเข้ากลุ่มร้านแล้วพิมพ์ 1 ข้อความ)</li>
          <li>กด <b>🔍 ค้นหา</b> เพื่อดึง Chat ID</li>
          <li>เปิดใช้งาน → บันทึก → ส่งทดสอบ</li>
        </ol>
      </div>
      <div class="panel">
        <h6 class="mb-2">ประวัติการแจ้งเตือน</h6>
        ${log.length ? log.map(l => `<div class="py-1 border-bottom small" style="border-color:var(--line)!important">
            <div class="d-flex justify-content-between"><b>${NOTIFY_EVENT[l.event] || esc(l.event)}</b>
              <span class="text-muted-t">${fmtDateTime(l.created_at)}</span></div>
            <div class="text-muted-t text-truncate">${esc(l.message.replace(/<[^>]+>/g, '').split('\n').slice(0, 2).join(' · '))}</div>
          </div>`).join('') : '<div class="text-muted-t small">ยังไม่มีการแจ้งเตือน</div>'}
      </div>
    </div>
  </div>`;
}

async function saveShop(e) {
  e.preventDefault();
  const f = e.target, obj = {};
  ['shop_name', 'shop_address', 'shop_phone', 'tax_id', 'promptpay_id', 'receipt_footer'].forEach(k => obj[k] = f[k].value.trim());
  ['service_charge_pct', 'vat_pct'].forEach(k => obj[k] = Number(f[k].value) || 0);
  try { await API.saveSettings(obj); toast('บันทึกการตั้งค่าแล้ว', 'ok'); }
  catch (ex) { toast(esc(ex.message), 'err'); }
}

async function saveNotify(e) {
  e.preventDefault();
  const f = e.target;
  try {
    await API.saveNotifySettings({
      enabled: f.enabled.checked,
      telegram_bot_token: f.telegram_bot_token.value,
      telegram_chat_id: f.telegram_chat_id.value,
      notify_order: f.notify_order.checked, notify_bill: f.notify_bill.checked,
      notify_payment: f.notify_payment.checked, notify_table: f.notify_table.checked
    });
    toast('บันทึกการแจ้งเตือนแล้ว 🔔', 'ok');
  } catch (ex) { toast(esc(ex.message), 'err'); }
}

async function findChat() {
  const token = document.getElementById('tgToken').value.trim();
  const box = document.getElementById('chatList');
  if (!token) { toast('กรอก Bot Token ก่อนนะคะ', 'err'); return; }
  box.innerHTML = '<span class="text-muted-t">กำลังค้นหา…</span>';
  try {
    const chats = await API.telegramFindChats(token);
    box.innerHTML = chats.length
      ? '<div class="text-muted-t mb-1">เลือกแชทที่จะรับการแจ้งเตือน:</div>' + chats.map(c =>
          `<button type="button" class="btn btn-outline-t btn-sm me-1 mb-1"
             onclick="document.getElementById('tgChat').value='${esc(String(c.id))}';toast('เลือก ${esc(c.title)} แล้ว','ok')">
             ${c.type === 'private' ? '👤' : '👥'} ${esc(c.title)}</button>`).join('')
      : '<span class="text-danger">ยังไม่พบแชท — เปิดแชทกับบอทแล้วกด Start ก่อน แล้วลองใหม่</span>';
  } catch (ex) { box.innerHTML = '<span class="text-danger">' + esc(ex.message) + '</span>'; }
}

async function testTg() {
  const btn = document.getElementById('btnTest'), out = document.getElementById('tgResult');
  btn.disabled = true; out.innerHTML = '<span class="text-muted-t">กำลังส่ง… (ต้องกดบันทึกก่อน)</span>';
  try {
    const r = await API.telegramTest();
    out.innerHTML = !r.done ? '<span class="text-warning">ส่งคำขอแล้วแต่ยังไม่ได้ผลตอบกลับ — ลองเช็คใน Telegram</span>'
      : r.status === 200 ? '<span class="text-success">✅ ส่งสำเร็จ — ดูข้อความใน Telegram ได้เลย</span>'
      : '<span class="text-danger">❌ Telegram ตอบ ' + esc(String(r.status)) + ': ' + esc(r.body || r.error || '') + '</span>';
  } catch (ex) { out.innerHTML = '<span class="text-danger">' + esc(ex.message) + '</span>'; }
  finally { btn.disabled = false; }
}

Object.assign(window, {
  adminStart, go, editItem, setImg, uploadImg, saveItem, toggleAvail, delItem,
  exportBills, updStaff, saveShop, saveNotify, findChat, testTg
});
