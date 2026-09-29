/* =============================================================
   menu.js — หน้าสั่งอาหารสำหรับลูกค้า (เปิดจากการสแกน QR)
   ใช้ token จาก ?t= เท่านั้น ไม่ต้องล็อกอิน
   ============================================================= */

const TOKEN = new URLSearchParams(location.search).get('t') || '';
const CART_KEY = 'tsuki_cart_' + TOKEN;

let C_MENU = [];
let C_CATS = [];
let C_SESSION = null;
let C_ORDERS = [];
let C_CAT = 'all';
let CART = {};        // { menu_item_id: { qty, note } }

/* ---------------------------------------------------- เริ่มต้น */
async function custStart() {
  if (!TOKEN) return fatal('ไม่พบรหัสโต๊ะ', 'กรุณาสแกน QR ที่โต๊ะอีกครั้ง หรือเรียกพนักงานช่วยค่ะ');
  loadCart();
  try {
    const [res, menu, cats] = await Promise.all([
      API.sessionByToken(TOKEN), API.getMenu(), API.getCategories()
    ]);
    if (!res.ok) return fatal(res.closed ? 'ปิดบิลแล้ว 🙏' : 'เปิดเมนูไม่ได้', res.error);
    C_SESSION = res.session; C_ORDERS = res.orders || [];
    C_MENU = menu; C_CATS = cats;
  } catch (e) { return fatal('เชื่อมต่อไม่สำเร็จ', e.message); }

  renderHeader();
  renderMenu();
  renderCart();
  /* อัปเดตสถานะออเดอร์อัตโนมัติทุก 20 วินาที */
  setInterval(refreshSession, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshSession(); });
}

function fatal(title, msg) {
  document.getElementById('main').innerHTML = `
    <div class="text-center py-5">
      <div style="font-size:3rem">🍣</div>
      <h4 class="mt-2">${esc(title)}</h4>
      <p class="text-muted-t">${esc(msg || '')}</p>
    </div>`;
  document.getElementById('tableChip').textContent = '—';
  document.getElementById('cartBar').classList.remove('show');
  document.getElementById('btnBill').disabled = true;
}

async function refreshSession() {
  try {
    const res = await API.sessionByToken(TOKEN);
    if (!res.ok) { fatal(res.closed ? 'ปิดบิลแล้ว 🙏' : 'เปิดเมนูไม่ได้', res.error); return; }
    C_SESSION = res.session; C_ORDERS = res.orders || [];
    renderHeader();
    if (document.getElementById('ordersCanvas').classList.contains('show')) renderOrders();
  } catch (e) { /* เงียบไว้ ไม่รบกวนลูกค้า */ }
}

/* ---------------------------------------------------- หัวจอ */
function renderHeader() {
  const s = C_SESSION;
  document.getElementById('tableChip').innerHTML = `🪑 โต๊ะ <b>${esc(s.table_no)}</b> · ${s.guests} ท่าน`;
  document.getElementById('sessionMeta').textContent = s.session_no;
  const n = C_ORDERS.reduce((a, o) => a + (o.items || []).length, 0);
  document.getElementById('ordersBadge').textContent = n;
  const billing = s.status === 'billing';
  const btn = document.getElementById('btnBill');
  btn.disabled = billing || !n;
  btn.textContent = billing ? '⏳ พนักงานกำลังมาเก็บเงิน' : '💳 เรียกเก็บเงิน';
  document.getElementById('btnSend').disabled = billing;
}

/* ---------------------------------------------------- เมนู */
function renderMenu() {
  const cats = [{ id: 'all', name: 'ทั้งหมด', emoji: '🍱' },
                { id: 'popular', name: 'ยอดนิยม', emoji: '⭐' }, ...C_CATS];
  document.getElementById('main').innerHTML = `
    <div class="cat-bar" id="catBar">
      ${cats.map(c => `<button class="cat-pill ${C_CAT === c.id ? 'active' : ''}" onclick="setCat('${c.id}')">${c.emoji || ''} ${esc(c.name)}</button>`).join('')}
    </div>
    <div id="dishes" class="pt-2"></div>`;
  renderDishes();
}

function setCat(id) {
  C_CAT = id;
  document.querySelectorAll('.cat-pill').forEach((b, i) => {
    b.classList.toggle('active', b.getAttribute('onclick').includes(`'${id}'`));
  });
  renderDishes();
  window.scrollTo({ top: document.getElementById('dishes').offsetTop - 70, behavior: 'smooth' });
}

function dishesOf(cat) {
  if (cat === 'all') return C_MENU;
  if (cat === 'popular') return C_MENU.filter(m => m.is_popular);
  return C_MENU.filter(m => m.category_id === cat);
}

function renderDishes() {
  const list = dishesOf(C_CAT);
  const byCat = {};
  list.forEach(m => { (byCat[m.category_id] ||= []).push(m); });
  const order = C_CAT === 'all' || C_CAT === 'popular' ? C_CATS.map(c => c.id) : [C_CAT];

  document.getElementById('dishes').innerHTML = order.filter(cid => byCat[cid]?.length).map(cid => {
    const c = C_CATS.find(x => x.id === cid) || { name: cid, emoji: '' };
    return `
      <h6 class="mt-3 mb-2">${c.emoji} ${esc(c.name)} <span class="text-muted-t" style="font-weight:300;font-size:.8rem">${esc(c.name_en || '')}</span></h6>
      ${byCat[cid].map(dishCard).join('')}`;
  }).join('') || '<div class="text-center text-muted-t py-5">ยังไม่มีเมนูในหมวดนี้</div>';
}

function dishCard(m) {
  const qty = CART[m.id]?.qty || 0;
  const badges = [
    m.is_popular ? '<span class="tag tag-gold">⭐ ยอดนิยม</span>' : '',
    m.is_raw ? '<span class="tag tag-raw">ของดิบ</span>' : '',
    m.is_spicy ? '<span class="tag tag-spicy">เผ็ด</span>' : ''
  ].join(' ');
  return `
  <div class="dish ${m.available ? '' : 'soldout'}">
    <img class="dish-img" src="${esc(m.image_url)}" alt="${esc(m.name)}" loading="lazy"
         onerror="this.src='assets/images/placeholder.svg'">
    <div class="dish-body">
      <div class="d-flex justify-content-between gap-2">
        <div style="min-width:0">
          <p class="dish-name">${esc(m.name)}</p>
          <div class="dish-en">${esc(m.name_en || '')} · ${esc(m.code)}</div>
        </div>
        <div class="dish-price">${money(m.price)}</div>
      </div>
      <p class="dish-desc">${esc(m.description || '')}</p>
      <div class="d-flex justify-content-between align-items-center mt-auto pt-2">
        <div class="d-flex gap-1">${badges}</div>
        ${m.available ? `
          <div class="stepper">
            ${qty ? `<button class="step-btn" onclick="addItem('${m.id}',-1)">−</button>
                     <span class="step-qty">${qty}</span>` : ''}
            <button class="step-btn plus" onclick="addItem('${m.id}',1)">+</button>
          </div>`
        : '<span class="tag tag-out">หมดชั่วคราว</span>'}
      </div>
    </div>
  </div>`;
}

/* ---------------------------------------------------- ตะกร้า */
function loadCart() { try { CART = JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { CART = {}; } }
function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(CART)); } catch {} }

function addItem(id, delta) {
  const m = C_MENU.find(x => x.id === id);
  if (!m || !m.available) return;
  const cur = CART[id]?.qty || 0;
  const next = Math.max(0, Math.min(99, cur + delta));
  if (next === 0) delete CART[id];
  else CART[id] = { qty: next, note: CART[id]?.note || '' };
  saveCart();
  renderDishes();
  renderCart();
  if (delta > 0 && cur === 0) toast('เพิ่ม <b>' + esc(m.name) + '</b> แล้ว', 'ok', 1400);
}

function setNote(id, note) { if (CART[id]) { CART[id].note = note.slice(0, 200); saveCart(); } }

function cartArray() {
  return Object.entries(CART).map(([id, v]) => {
    const m = C_MENU.find(x => x.id === id);
    return m ? { ...m, qty: v.qty, note: v.note } : null;
  }).filter(Boolean);
}

function renderCart() {
  const items = cartArray();
  const count = items.reduce((a, i) => a + i.qty, 0);
  const total = items.reduce((a, i) => a + i.qty * Number(i.price), 0);

  document.getElementById('cartBar').classList.toggle('show', count > 0);
  document.getElementById('cartCount').textContent = count + ' รายการ';
  document.getElementById('cartTotal').textContent = money(total);
  document.getElementById('cartTotal2').textContent = money(total);

  document.getElementById('cartLines').innerHTML = items.length ? items.map(i => `
    <div class="cart-line">
      <img src="${esc(i.image_url)}" onerror="this.src='assets/images/placeholder.svg'" alt="">
      <div class="flex-grow-1" style="min-width:0">
        <div class="d-flex justify-content-between gap-2">
          <div style="font-weight:500">${esc(i.name)}</div>
          <div style="white-space:nowrap">${money(i.price * i.qty)}</div>
        </div>
        <input class="form-control form-control-sm mt-1" placeholder="หมายเหตุ เช่น ไม่ใส่วาซาบิ"
               value="${esc(i.note || '')}" onchange="setNote('${i.id}', this.value)">
        <div class="stepper mt-2">
          <button class="step-btn" onclick="addItem('${i.id}',-1)">−</button>
          <span class="step-qty">${i.qty}</span>
          <button class="step-btn plus" onclick="addItem('${i.id}',1)">+</button>
        </div>
      </div>
    </div>`).join('') : '<div class="text-center text-muted-t py-4">ตะกร้าว่างอยู่ — เลือกเมนูที่อยากทานได้เลยค่ะ</div>';
}

function openCart() { bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('cartCanvas')).show(); }

/* ---------------------------------------------------- ส่งออเดอร์ */
async function submitOrder() {
  const items = cartArray();
  if (!items.length) { toast('ยังไม่ได้เลือกเมนูเลยค่ะ', 'err'); return; }
  const btn = document.getElementById('btnSend');
  btn.disabled = true; btn.textContent = 'กำลังส่ง…';
  try {
    const note = document.getElementById('orderNote').value.trim();
    const res = await API.placeOrder(TOKEN,
      items.map(i => ({ menu_item_id: i.id, qty: i.qty, note: i.note || '' })), note);
    CART = {}; saveCart();
    document.getElementById('orderNote').value = '';
    bootstrap.Offcanvas.getInstance(document.getElementById('cartCanvas'))?.hide();
    renderDishes(); renderCart();
    await refreshSession();
    toast('ส่งออเดอร์เข้าครัวแล้ว 🍣<br>' + esc(res.order_no), 'ok', 3200);
    openOrders();
  } catch (e) {
    toast(esc(e.message), 'err', 4000);
  } finally {
    btn.disabled = false; btn.textContent = 'ส่งออเดอร์ 🍣';
  }
}

/* ---------------------------------------------------- ออเดอร์ของฉัน */
function openOrders() {
  renderOrders();
  bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('ordersCanvas')).show();
}

function renderOrders() {
  const s = C_SESSION;
  const body = document.getElementById('ordersBody');
  if (!C_ORDERS.length) {
    body.innerHTML = '<div class="text-center text-muted-t py-4">ยังไม่มีออเดอร์ — เลือกเมนูแล้วกดส่งได้เลยค่ะ</div>';
    return;
  }
  const svc = Number(s.service_charge) || 0, vat = Number(s.vat) || 0;
  body.innerHTML = `
    ${C_ORDERS.map(o => `
      <div class="panel mb-2">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div>
            <b>รอบที่ ${o.round_no}</b>
            <span class="text-muted-t" style="font-size:.76rem"> · ${fmtTime(o.created_at)}</span>
          </div>
          ${statusTag('orderStatus', o.status)}
        </div>
        ${(o.items || []).map(i => `
          <div class="d-flex justify-content-between align-items-center py-1" style="font-size:.92rem">
            <div style="min-width:0">
              ${esc(i.name)} <span class="text-muted-t">×${i.qty}</span>
              ${i.note ? `<div class="text-muted-t" style="font-size:.72rem">📝 ${esc(i.note)}</div>` : ''}
            </div>
            <div class="d-flex align-items-center gap-2">
              ${statusTag('itemStatus', i.status)}
              <span style="white-space:nowrap">${money(i.line_total)}</span>
            </div>
          </div>`).join('')}
      </div>`).join('')}
    <div class="panel">
      <div class="d-flex justify-content-between small"><span>ยอดอาหาร</span><span>${money(s.subtotal)}</span></div>
      ${svc > 0 ? `<div class="d-flex justify-content-between small"><span>Service Charge</span><span>${money(svc)}</span></div>` : ''}
      ${vat > 0 ? `<div class="d-flex justify-content-between small"><span>VAT</span><span>${money(vat)}</span></div>` : ''}
      <div class="d-flex justify-content-between mt-2 pt-2 border-top">
        <b>ยอดรวม</b>
        <b style="font-family:Poppins,sans-serif;font-size:1.25rem" class="text-red">${money(s.total)}</b>
      </div>
      <div class="small text-muted-t mt-2">* ยอดจะอัปเดตอัตโนมัติเมื่อมีออเดอร์ใหม่</div>
    </div>`;
}

/* ---------------------------------------------------- เรียกเก็บเงิน */
async function askBill() {
  if (!confirm('ต้องการเรียกพนักงานมาเก็บเงินใช่ไหมคะ?\n(หลังจากนี้จะสั่งอาหารเพิ่มไม่ได้)')) return;
  const btn = document.getElementById('btnBill');
  btn.disabled = true; btn.textContent = 'กำลังเรียก…';
  try {
    await API.requestBill(TOKEN);
    await refreshSession();
    toast('เรียกพนักงานแล้วค่ะ 🙏 กรุณารอสักครู่', 'ok', 4000);
    openOrders();
  } catch (e) {
    toast(esc(e.message), 'err');
    btn.disabled = false; btn.textContent = '💳 เรียกเก็บเงิน';
  }
}

Object.assign(window, { custStart, setCat, addItem, setNote, openCart, submitOrder, openOrders, askBill });
