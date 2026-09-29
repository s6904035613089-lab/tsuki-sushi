/* =============================================================
   host.js — ขั้นที่ 1: กรอกเลขโต๊ะ + จำนวนคน → สร้าง QR ให้ลูกค้าสแกน
   ใช้ได้โดยไม่ต้องล็อกอิน (ถ้าพนักงานล็อกอินอยู่ ระบบจะบันทึกว่าใครเปิดโต๊ะ)
   ============================================================= */

let H_TABLES = [];      // [{ table_no, seats, zone, busy, guests, status, opened_at, has_orders }]
let H_PICK = null;

const customerURL = token =>
  location.origin + location.pathname.replace(/[^/]*$/, '') + 'menu.html?t=' + encodeURIComponent(token);

async function loadAll() {
  try { H_TABLES = await API.listTables(); }
  catch (e) { toast('โหลดรายชื่อโต๊ะไม่สำเร็จ: ' + esc(e.message), 'err'); return; }
  if (H_PICK && H_TABLES.find(t => t.table_no === H_PICK)?.busy) H_PICK = null;
  renderZones();
  renderOpenList();
  renderGuestQuick();
  syncButton();
}

const tableOf = no => H_TABLES.find(t => t.table_no === no);

/* ---------------------------------------------------- 1. เลือกโต๊ะ */
function renderZones() {
  const zones = [...new Set(H_TABLES.map(t => t.zone))];
  document.getElementById('zones').innerHTML = zones.map(z => `
    <div class="mb-3">
      <div class="small text-muted-t mb-2">${esc(z)}</div>
      <div class="table-pick">
        ${H_TABLES.filter(t => t.zone === z).map(t => `
          <button class="table-btn ${t.busy ? 'busy' : ''} ${H_PICK === t.table_no ? 'active' : ''}"
                  onclick="pickTable('${esc(t.table_no)}')" title="${t.busy ? 'มีลูกค้าอยู่' : 'ว่าง'}">
            ${esc(t.table_no)}
            <small>${t.busy ? t.guests + ' ท่าน' : t.seats + ' ที่นั่ง'}</small>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function pickTable(no) {
  const t = tableOf(no);
  if (!t) return;
  if (t.busy) {
    if (confirm(`โต๊ะ ${no} เปิดอยู่แล้ว (${t.session_no})\nต้องการดู QR เดิมของโต๊ะนี้ไหม?`)) reopenQR(no);
    return;
  }
  H_PICK = no;
  document.getElementById('guests').value = Math.min(t.seats, 30);
  renderZones();
  renderGuestQuick();
  syncButton();
  document.getElementById('step2').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ---------------------------------------------------- 2. จำนวนคน */
function renderGuestQuick() {
  const cur = Number(document.getElementById('guests').value) || 0;
  document.getElementById('guestQuick').innerHTML = [1, 2, 3, 4, 6, 8].map(n =>
    `<button class="btn ${cur === n ? 'btn-ink' : 'btn-outline-t'} btn-sm" onclick="setGuests(${n})">${n} ท่าน</button>`).join('');
}
function setGuests(n) { document.getElementById('guests').value = n; renderGuestQuick(); syncButton(); }
function bumpGuests(d) {
  const el = document.getElementById('guests');
  el.value = Math.max(1, Math.min(30, (Number(el.value) || 1) + d));
  renderGuestQuick(); syncButton();
}

function syncButton() {
  const btn = document.getElementById('btnOpen');
  const guests = Number(document.getElementById('guests').value) || 0;
  btn.disabled = !H_PICK || guests < 1;
  document.getElementById('pickInfo').innerHTML = H_PICK
    ? `โต๊ะ <b>${esc(H_PICK)}</b> · <b>${guests}</b> ท่าน`
    : '<span class="text-muted-t">ยังไม่ได้เลือกโต๊ะ</span>';
}

/* ---------------------------------------------------- 3. เปิดโต๊ะ → QR */
async function openTable() {
  const err = document.getElementById('openErr');
  const btn = document.getElementById('btnOpen');
  const guests = Number(document.getElementById('guests').value) || 0;
  err.classList.add('d-none');
  if (!H_PICK) { toast('เลือกโต๊ะก่อนนะคะ', 'err'); return; }
  if (guests < 1) { toast('ใส่จำนวนคนก่อนนะคะ', 'err'); return; }

  btn.disabled = true; btn.textContent = 'กำลังสร้าง QR…';
  try {
    const s = await API.openTable(H_PICK, guests);
    toast('เปิดโต๊ะ ' + esc(s.table_no) + ' แล้ว 🎉', 'ok');
    showQR(s);
    H_PICK = null;
    await loadAll();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📱 สร้าง QR สำหรับโต๊ะนี้';
    syncButton();
  }
}

async function reopenQR(tableNo) {
  try { showQR(await API.tableQR(tableNo)); }
  catch (e) { toast(esc(e.message), 'err'); }
}

/* ---------------------------------------------------- QR */
function showQR(s) {
  const url = customerURL(s.token);
  document.getElementById('qrTable').textContent = 'โต๊ะ ' + (s.table_no || '-');
  document.getElementById('qrMeta').textContent =
    s.session_no + ' · ' + s.guests + ' ท่าน · เปิด ' + fmtTime(s.opened_at);
  document.getElementById('qrUrl').textContent = url;
  document.getElementById('qrOpenLink').href = url;

  const box = document.getElementById('qrCanvas');
  box.innerHTML = '';
  new QRCode(box, { text: url, width: 220, height: 220,
                    colorDark: '#151a33', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  window._qrURL = url;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('qrModal')).show();
}

function printQR() {
  const card = document.getElementById('qrCard').cloneNode(true);
  const img = card.querySelector('img');
  if (img) img.src = new URL(img.getAttribute('src'), location.href).href;
  const w = window.open('', '_blank', 'width=420,height=640');
  w.document.write(`<html><head><title>QR โต๊ะ</title>
    <link href="${new URL('assets/vendor/bootstrap.min.css', location.href).href}" rel="stylesheet">
    <link href="${new URL('assets/css/style.css', location.href).href}" rel="stylesheet">
    <style>body{padding:18px;background:#fff}</style></head>
    <body>${card.outerHTML}<script>setTimeout(()=>{print();close()},500)<\/script></body></html>`);
  w.document.close();
}

async function copyLink() {
  try { await navigator.clipboard.writeText(window._qrURL); toast('คัดลอกลิงก์แล้ว 📋', 'ok'); }
  catch { toast('คัดลอกไม่สำเร็จ — กดค้างที่ลิงก์เพื่อคัดลอกแทน', 'err'); }
}

/* ---------------------------------------------------- โต๊ะที่เปิดอยู่ */
function renderOpenList() {
  const open = H_TABLES.filter(t => t.busy);
  const box = document.getElementById('openList');
  if (!open.length) {
    box.innerHTML = '<div class="text-center text-muted-t py-4">ยังไม่มีโต๊ะที่เปิดอยู่</div>';
    return;
  }
  box.innerHTML = open.map(t => `
    <div class="d-flex align-items-center gap-3 py-2 border-bottom" style="border-color:var(--line)!important">
      <div style="font-family:Poppins,sans-serif;font-weight:600;font-size:1.3rem;min-width:44px">${esc(t.table_no)}</div>
      <div class="flex-grow-1" style="min-width:0">
        <div class="small">${esc(t.session_no)} · ${t.guests} ท่าน</div>
        <div class="text-muted-t" style="font-size:.76rem">${agoText(t.opened_at)}${t.has_orders ? ' · สั่งอาหารแล้ว' : ''}</div>
      </div>
      ${statusTag('sessionStatus', t.status)}
      <button class="btn btn-ghost btn-sm" onclick="reopenQR('${esc(t.table_no)}')" title="ดู QR อีกครั้ง">📱</button>
      ${t.has_orders ? '' :
        `<button class="btn btn-ghost btn-sm text-danger" onclick="cancelTable('${esc(t.table_no)}')" title="ยกเลิกโต๊ะ (เปิดผิด)">✕</button>`}
    </div>`).join('');
}

async function cancelTable(tableNo) {
  if (!confirm('ยกเลิกโต๊ะ ' + tableNo + ' ?\n(ใช้เมื่อเปิดผิดโต๊ะ — QR เดิมจะใช้ไม่ได้)')) return;
  try {
    const s = await API.tableQR(tableNo);
    await API.cancelSession(s.id, 'ยกเลิกจากหน้าสร้าง QR');
    toast('ยกเลิกโต๊ะ ' + esc(tableNo) + ' แล้ว', 'ok');
    loadAll();
  } catch (e) { toast(esc(e.message), 'err'); }
}

Object.assign(window, {
  loadAll, pickTable, setGuests, bumpGuests, syncButton,
  openTable, reopenQR, showQR, printQR, copyLink, cancelTable
});
