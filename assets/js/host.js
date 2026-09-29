/* =============================================================
   host.js — หน้าเปิดโต๊ะและสร้าง QR สำหรับลูกค้า
   ============================================================= */

let H_TABLES = [];
let H_OPEN = [];
let H_PICK = null;      // table_no ที่เลือก
let H_LAST = null;      // session ล่าสุดที่เพิ่งเปิด (สำหรับ QR)

const customerURL = token =>
  location.origin + location.pathname.replace(/[^/]*$/, '') + 'menu.html?t=' + encodeURIComponent(token);

async function loadAll() {
  try {
    [H_TABLES, H_OPEN] = await Promise.all([API.getTables(), API.getOpenSessions()]);
  } catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + esc(e.message), 'err'); return; }
  renderZones();
  renderOpenList();
  renderGuestQuick();
}

/* ---------------------------------------------------- เลือกโต๊ะ */
const busyOf = tableNo => H_OPEN.find(s => s.dining_tables?.table_no === tableNo);

function renderZones() {
  const zones = [...new Set(H_TABLES.map(t => t.zone))];
  document.getElementById('zones').innerHTML = zones.map(z => `
    <div class="mb-3">
      <div class="small text-muted-t mb-2">${esc(z)}</div>
      <div class="table-pick">
        ${H_TABLES.filter(t => t.zone === z).map(t => {
          const busy = busyOf(t.table_no);
          return `<button class="table-btn ${busy ? 'busy' : ''} ${H_PICK === t.table_no ? 'active' : ''}"
                    onclick="pickTable('${esc(t.table_no)}')" title="${busy ? 'มีลูกค้าอยู่' : 'ว่าง'}">
                    ${esc(t.table_no)}
                    <small>${busy ? busy.guests + ' ท่าน' : t.seats + ' ที่นั่ง'}</small>
                  </button>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function pickTable(no) {
  const busy = busyOf(no);
  if (busy) {
    if (confirm('โต๊ะ ' + no + ' มีลูกค้าอยู่ (' + busy.session_no + ')\nต้องการดู QR เดิมของโต๊ะนี้ไหม?')) showQR(busy);
    return;
  }
  H_PICK = no;
  const t = H_TABLES.find(x => x.table_no === no);
  if (t) document.getElementById('guests').value = Math.min(t.seats, 30);
  document.getElementById('btnOpen').disabled = false;
  renderZones();
  renderGuestQuick();
}

function renderGuestQuick() {
  const cur = Number(document.getElementById('guests').value) || 0;
  document.getElementById('guestQuick').innerHTML = [1, 2, 3, 4, 6, 8].map(n =>
    `<button class="btn ${cur === n ? 'btn-ink' : 'btn-outline-t'} btn-sm" onclick="setGuests(${n})">${n} ท่าน</button>`).join('');
}
function setGuests(n) { document.getElementById('guests').value = n; renderGuestQuick(); }
function bumpGuests(d) {
  const el = document.getElementById('guests');
  el.value = Math.max(1, Math.min(30, (Number(el.value) || 1) + d));
  renderGuestQuick();
}

/* ---------------------------------------------------- เปิดโต๊ะ */
async function openTable() {
  const err = document.getElementById('openErr');
  const btn = document.getElementById('btnOpen');
  const guests = Number(document.getElementById('guests').value) || 0;
  err.classList.add('d-none');
  if (!H_PICK) { toast('เลือกโต๊ะก่อนนะคะ', 'err'); return; }
  if (guests < 1) { toast('ใส่จำนวนคนก่อนนะคะ', 'err'); return; }

  btn.disabled = true; btn.textContent = 'กำลังเปิดโต๊ะ…';
  try {
    const s = await API.openTable(H_PICK, guests);
    H_LAST = s;
    toast('เปิดโต๊ะ ' + esc(s.table_no) + ' แล้ว 🎉', 'ok');
    showQR(s);
    H_PICK = null;
    await loadAll();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🪑 เปิดโต๊ะ &amp; สร้าง QR';
  }
}

/* ---------------------------------------------------- QR */
function showQR(s) {
  const tableNo = s.table_no || s.dining_tables?.table_no || '-';
  const url = customerURL(s.token);
  document.getElementById('qrTable').textContent = 'โต๊ะ ' + tableNo;
  document.getElementById('qrMeta').textContent = s.session_no + ' · ' + s.guests + ' ท่าน · ' + fmtTime(s.opened_at);
  document.getElementById('qrUrl').textContent = url;
  document.getElementById('qrOpenLink').href = url;

  const box = document.getElementById('qrCanvas');
  box.innerHTML = '';
  new QRCode(box, { text: url, width: 220, height: 220, colorDark: '#151a33', colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M });
  window._qrURL = url;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('qrModal')).show();
}

function printQR() {
  const card = document.getElementById('qrCard').cloneNode(true);
  const img = card.querySelector('img');
  if (img) img.src = new URL(img.getAttribute('src'), location.href).href;
  const w = window.open('', '_blank', 'width=420,height=620');
  w.document.write(`<html><head><title>QR โต๊ะ</title>
    <link href="${new URL('assets/vendor/bootstrap.min.css', location.href).href}" rel="stylesheet">
    <link href="${new URL('assets/css/style.css', location.href).href}" rel="stylesheet">
    <style>body{padding:18px;background:#fff}</style></head>
    <body>${card.outerHTML}<script>setTimeout(()=>{print();close()},500)<\/script></body></html>`);
  w.document.close();
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window._qrURL);
    toast('คัดลอกลิงก์แล้ว 📋', 'ok');
  } catch { toast('คัดลอกไม่สำเร็จ — กดค้างที่ลิงก์เพื่อคัดลอกแทน', 'err'); }
}

/* ---------------------------------------------------- โต๊ะที่เปิดอยู่ */
function renderOpenList() {
  const box = document.getElementById('openList');
  if (!H_OPEN.length) {
    box.innerHTML = '<div class="text-center text-muted-t py-4">ยังไม่มีโต๊ะที่เปิดอยู่</div>';
    return;
  }
  box.innerHTML = H_OPEN.map(s => `
    <div class="d-flex align-items-center gap-3 py-2 border-bottom" style="border-color:var(--line)!important">
      <div style="font-family:Poppins,sans-serif;font-weight:600;font-size:1.3rem;min-width:44px">${esc(s.dining_tables?.table_no || '-')}</div>
      <div class="flex-grow-1" style="min-width:0">
        <div class="small">${esc(s.session_no)} · ${s.guests} ท่าน</div>
        <div class="text-muted-t" style="font-size:.76rem">เปิดเมื่อ ${fmtTime(s.opened_at)} (${agoText(s.opened_at)})</div>
      </div>
      ${statusTag('sessionStatus', s.status)}
      <button class="btn btn-ghost btn-sm" onclick='showQR(${JSON.stringify(s).replace(/'/g, "&#39;")})' title="ดู QR">📱</button>
      <button class="btn btn-ghost btn-sm text-danger" onclick="cancelTable('${s.id}','${esc(s.dining_tables?.table_no || '')}')" title="ยกเลิกโต๊ะ">✕</button>
    </div>`).join('');
}

async function cancelTable(id, no) {
  if (!confirm('ยกเลิกโต๊ะ ' + no + ' ?\nรายการอาหารที่สั่งไว้จะถูกยกเลิกทั้งหมด (ใช้เมื่อเปิดโต๊ะผิด)')) return;
  try {
    await API.cancelSession(id, 'ยกเลิกโดยพนักงาน');
    toast('ยกเลิกโต๊ะ ' + esc(no) + ' แล้ว', 'ok');
    loadAll();
  } catch (e) { toast(esc(e.message), 'err'); }
}

Object.assign(window, { loadAll, pickTable, setGuests, bumpGuests, openTable, showQR, printQR, copyLink, cancelTable });
