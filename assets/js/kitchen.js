/* =============================================================
   kitchen.js — หน้าจอครัว (Kitchen Display System)
   อัปเดตแบบเรียลไทม์เมื่อลูกค้าสั่งอาหาร
   ============================================================= */

let K_ORDERS = [];
let K_SEEN = new Set();       // ออเดอร์ที่เคยเห็นแล้ว (กันเสียงเตือนซ้ำ)
let K_SERVED = 0;
let K_FIRST = true;

async function kdsStart() {
  await kdsLoad();
  /* เรียลไทม์: มีออเดอร์ใหม่/เปลี่ยนสถานะ → โหลดใหม่ */
  API.watch(['orders', 'order_items'], () => kdsLoad());
  /* กันกรณี realtime หลุด + อัปเดตเวลาที่ผ่านไป */
  setInterval(kdsLoad, 25000);
  setInterval(renderKDS, 30000);
}

async function kdsLoad() {
  try {
    const [orders, served] = await Promise.all([API.getKitchenOrders(), API.getServedToday()]);
    K_SERVED = (served || []).length;

    /* ออเดอร์ใหม่ที่ยังไม่เคยเห็น → เตือน */
    const fresh = orders.filter(o => !K_SEEN.has(o.id) && o.status === 'pending');
    orders.forEach(o => K_SEEN.add(o.id));
    if (!K_FIRST && fresh.length) {
      beep();
      const t = fresh[0].table_sessions?.dining_tables?.table_no || '?';
      toast('🔔 ออเดอร์ใหม่ โต๊ะ <b>' + esc(t) + '</b>' + (fresh.length > 1 ? ` (+${fresh.length - 1})` : ''), 'ok', 4000);
    }
    K_FIRST = false;
    K_ORDERS = orders;
    setLive(true);
    renderKDS();
  } catch (e) {
    setLive(false, e.message);
  }
}

function setLive(ok, msg) {
  const el = document.getElementById('liveDot');
  el.style.color = ok ? '#7fd18c' : '#f08a8a';
  el.textContent = ok ? '● เชื่อมต่อแล้ว' : '● หลุดการเชื่อมต่อ' + (msg ? ' — ' + msg : '');
}

/* ---------------------------------------------------- เสียงเตือน */
function beep() {
  if (!document.getElementById('soundOn')?.checked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1180].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18); o.stop(ctx.currentTime + i * 0.18 + 0.24);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {}
}

/* ---------------------------------------------------- แสดงผล */
function renderKDS() {
  const pending = K_ORDERS.filter(o => o.status === 'pending');
  const cooking = K_ORDERS.filter(o => o.status === 'cooking');
  document.getElementById('cntPending').textContent = pending.length;
  document.getElementById('cntCooking').textContent = cooking.length;
  document.getElementById('cntServed').textContent = K_SERVED;

  const box = document.getElementById('kds');
  if (!K_ORDERS.length) {
    box.innerHTML = `<div class="kds-empty">
      <div style="font-size:3.4rem">🍣</div>
      <h5 class="mt-2">ยังไม่มีออเดอร์ค้าง</h5>
      <p class="mb-0">ออเดอร์ใหม่จะขึ้นที่นี่อัตโนมัติพร้อมเสียงเตือน</p></div>`;
    return;
  }
  /* เรียงตามเวลา — เก่าสุดขึ้นก่อน */
  box.innerHTML = `<div class="kds-grid">${[...pending, ...cooking]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map(card).join('')}</div>`;
}

function card(o) {
  const t = o.table_sessions?.dining_tables?.table_no || '?';
  const mins = minutesSince(o.created_at);
  const late = mins >= TS_CONFIG.lateAfterMinutes;
  const items = (o.order_items || []).filter(i => i.status !== 'cancelled')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return `
  <div class="kds-card ${o.status} ${late ? 'late' : ''}">
    <div class="kds-head">
      <div>
        <div class="kds-table">โต๊ะ ${esc(t)}</div>
        <div class="kds-time">${esc(o.order_no)} · รอบ ${o.round_no} · ${o.table_sessions?.guests || '-'} ท่าน</div>
      </div>
      <div class="text-end">
        ${statusTag('orderStatus', o.status)}
        <div class="kds-time mt-1" style="${late ? 'color:#ff8a8a;font-weight:500' : ''}">
          ${late ? '⏰ ' : ''}${mins} นาที
        </div>
      </div>
    </div>

    <div class="mt-2 flex-grow-1">
      ${items.map(i => `
        <div class="kds-item ${i.status === 'done' ? 'done' : ''}" onclick="toggleItem('${i.id}','${i.status}')" style="cursor:pointer">
          <span class="kds-qty">${i.qty}</span>
          <span class="flex-grow-1">
            ${esc(i.name)}
            ${i.note ? `<div class="kds-note">📝 ${esc(i.note)}</div>` : ''}
          </span>
          <span style="font-size:1.1rem">${i.status === 'done' ? '✅' : '⬜'}</span>
        </div>`).join('')}
      ${o.note ? `<div class="kds-note mt-2">📌 หมายเหตุออเดอร์: ${esc(o.note)}</div>` : ''}
    </div>

    <div class="d-flex gap-2 mt-3">
      ${o.status === 'pending'
        ? `<button class="btn btn-red flex-fill" onclick="setStatus('${o.id}','cooking')">▶ รับออเดอร์</button>`
        : `<button class="btn btn-ghost btn-sm text-white-50" onclick="setStatus('${o.id}','pending')">↩ ย้อนกลับ</button>`}
      <button class="btn btn-light flex-fill" onclick="setStatus('${o.id}','served')">✅ เสิร์ฟแล้ว</button>
    </div>
  </div>`;
}

/* ---------------------------------------------------- การกระทำ */
async function setStatus(orderId, status) {
  try {
    await API.setOrderStatus(orderId, status);
    if (status === 'served') toast('เสิร์ฟแล้ว ✅', 'ok', 1500);
    await kdsLoad();
  } catch (e) { toast(esc(e.message), 'err'); }
}

async function toggleItem(itemId, cur) {
  try {
    await API.setItemStatus(itemId, cur === 'done' ? 'cooking' : 'done');
    await kdsLoad();
  } catch (e) { toast(esc(e.message), 'err'); }
}

Object.assign(window, { kdsStart, kdsLoad, setStatus, toggleItem, renderKDS });
