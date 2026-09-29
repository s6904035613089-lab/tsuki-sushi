/* =============================================================
   cashier.js — หน้าแคชเชียร์: ดูบิล รับชำระเงิน ปิดโต๊ะ พิมพ์ใบเสร็จ
   ============================================================= */

let X_SESSIONS = [];
let X_BILL = null;        // บิลที่กำลังเปิดดู
let X_METHOD = 'cash';

async function cashStart() {
  await cashLoad();
  API.watch(['table_sessions', 'order_items'], () => cashLoad());
  setInterval(cashLoad, 30000);
}

async function cashLoad() {
  try {
    X_SESSIONS = await API.getOpenSessions();
  } catch (e) { toast('โหลดข้อมูลไม่สำเร็จ: ' + esc(e.message), 'err'); return; }
  renderTables();
  loadToday();
  if (X_BILL) {
    const still = X_SESSIONS.find(s => s.id === X_BILL.id);
    if (still) openBill(X_BILL.id, true);
  }
}

async function loadToday() {
  try {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const paid = await API.getSessions({ from: from.toISOString(), status: 'paid', limit: 500 });
    document.getElementById('todayBills').textContent = paid.length + ' บิล';
    document.getElementById('todayRevenue').textContent = money(paid.reduce((a, s) => a + Number(s.total), 0));
  } catch {}
}

/* ---------------------------------------------------- รายการโต๊ะ */
function renderTables() {
  const billing = X_SESSIONS.filter(s => s.status === 'billing');
  const open = X_SESSIONS.filter(s => s.status === 'open');
  document.getElementById('cntBilling').textContent = billing.length;
  document.getElementById('cntOpen').textContent = open.length;

  const row = s => `
    <button class="d-flex align-items-center gap-3 w-100 text-start py-2 px-2 border-0 bg-transparent border-bottom"
            style="border-color:var(--line)!important" onclick="openBill('${s.id}')">
      <span style="font-family:Poppins,sans-serif;font-weight:600;font-size:1.25rem;min-width:42px">${esc(s.dining_tables?.table_no || '-')}</span>
      <span class="flex-grow-1" style="min-width:0">
        <span class="small d-block">${esc(s.session_no)} · ${s.guests} ท่าน</span>
        <span class="text-muted-t" style="font-size:.74rem">${agoText(s.opened_at)}</span>
      </span>
      <span class="text-end">
        ${statusTag('sessionStatus', s.status)}
        <span class="d-block small fw-semibold">${money(s.total)}</span>
      </span>
    </button>`;

  const box = document.getElementById('tableList');
  box.innerHTML = (billing.length
      ? `<div class="small text-muted-t mb-1">🔔 รอเก็บเงิน</div>${billing.map(row).join('')}` : '')
    + (open.length
      ? `<div class="small text-muted-t mt-3 mb-1">กำลังทาน</div>${open.map(row).join('')}` : '')
    || '<div class="text-center text-muted-t py-4">ยังไม่มีโต๊ะที่เปิดอยู่</div>';
}

/* ---------------------------------------------------- บิล */
async function openBill(id, quiet = false) {
  try {
    X_BILL = await API.getBill(id);
  } catch (e) { toast(esc(e.message), 'err'); return; }
  const b = X_BILL;
  document.getElementById('billPane').innerHTML = `
    <div class="panel">
      <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <div>
          <h5 class="mb-1">โต๊ะ ${esc(b.table_no)} <span class="text-muted-t" style="font-weight:300;font-size:.9rem">${esc(b.zone || '')}</span></h5>
          <div class="small text-muted-t">${esc(b.session_no)} · ${b.guests} ท่าน · เปิดเมื่อ ${fmtTime(b.opened_at)} (${agoText(b.opened_at)})</div>
        </div>
        <div class="text-end">
          ${statusTag('sessionStatus', b.status)}
        </div>
      </div>

      <div class="table-responsive">
        <table class="table align-middle mb-0">
          <thead><tr><th>รายการ</th><th class="text-center">จำนวน</th><th class="text-end">ราคา</th><th class="text-end">รวม</th></tr></thead>
          <tbody>
            ${(b.items || []).map(i => `<tr>
              <td>${esc(i.name)}${i.note ? `<div class="text-muted-t" style="font-size:.74rem">📝 ${esc(i.note)}</div>` : ''}</td>
              <td class="text-center">${i.qty}</td>
              <td class="text-end">${money(i.unit_price)}</td>
              <td class="text-end fw-semibold">${money(i.line_total)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="text-center text-muted-t py-4">ยังไม่มีรายการอาหาร</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="d-flex justify-content-end mt-3">
        <div style="min-width:260px">
          <div class="d-flex justify-content-between"><span class="text-muted-t">ยอดอาหาร</span><span>${money(b.subtotal)}</span></div>
          ${Number(b.service_charge) > 0 ? `<div class="d-flex justify-content-between"><span class="text-muted-t">Service ${b.service_charge_pct}%</span><span>${money(b.service_charge)}</span></div>` : ''}
          ${Number(b.vat) > 0 ? `<div class="d-flex justify-content-between"><span class="text-muted-t">VAT ${b.vat_pct}%</span><span>${money(b.vat)}</span></div>` : ''}
          ${Number(b.discount) > 0 ? `<div class="d-flex justify-content-between text-danger"><span>ส่วนลด</span><span>−${money(b.discount)}</span></div>` : ''}
          <div class="d-flex justify-content-between mt-2 pt-2 border-top">
            <b>ยอดสุทธิ</b>
            <b class="text-red" style="font-family:Poppins,sans-serif;font-size:1.4rem">${money(b.total)}</b>
          </div>
        </div>
      </div>

      <div class="d-flex flex-wrap gap-2 mt-4">
        ${b.status === 'paid'
          ? `<button class="btn btn-outline-t" onclick="showReceipt()">🧾 ดูใบเสร็จ</button>`
          : `<button class="btn btn-red btn-lg flex-grow-1" onclick="openPay()" ${!(b.items || []).length ? 'disabled' : ''}>💳 รับชำระเงิน</button>
             <button class="btn btn-outline-t" onclick="printBill()">🖨️ พิมพ์บิลย่อย</button>
             <button class="btn btn-ghost text-danger" onclick="voidTable('${b.id}','${esc(b.table_no)}')">ยกเลิกโต๊ะ</button>`}
      </div>
    </div>`;
  if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function printBill() {
  document.getElementById('receipt').innerHTML = receiptHTML(X_BILL);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('receiptModal')).show();
}
function showReceipt() { printBill(); }
function closeReceipt() {
  bootstrap.Modal.getInstance(document.getElementById('receiptModal'))?.hide();
  X_BILL = null;
  document.getElementById('billPane').innerHTML = `
    <div class="panel text-center py-5 text-muted-t"><div style="font-size:3rem">🧾</div>
      <p class="mb-0 mt-2">เลือกโต๊ะทางซ้ายเพื่อดูบิล</p></div>`;
  cashLoad();
}

async function voidTable(id, no) {
  if (!confirm('ยกเลิกโต๊ะ ' + no + ' โดยไม่คิดเงิน?\nรายการอาหารทั้งหมดจะถูกยกเลิก')) return;
  try {
    await API.cancelSession(id, 'ยกเลิกที่แคชเชียร์');
    toast('ยกเลิกโต๊ะแล้ว', 'ok');
    X_BILL = null; closeReceipt();
  } catch (e) { toast(esc(e.message), 'err'); }
}

/* ---------------------------------------------------- รับชำระเงิน */
function openPay() {
  const b = X_BILL;
  document.getElementById('payTable').textContent = 'โต๊ะ ' + b.table_no + ' · ' + b.session_no;
  document.getElementById('payDiscount').value = Number(b.discount) || 0;
  document.getElementById('cashGot').value = '';
  document.getElementById('payRef').value = '';
  document.getElementById('payErr').classList.add('d-none');
  setMethod('cash');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('payModal')).show();
  setTimeout(() => document.getElementById('cashGot').focus(), 300);
}

function payTotal() {
  const b = X_BILL;
  const disc = Math.max(Number(document.getElementById('payDiscount').value) || 0, 0);
  const sub = Number(b.subtotal), svc = Number(b.service_charge), vat = Number(b.vat);
  return Math.max(sub + svc + vat - disc, 0);
}

function setMethod(m) {
  X_METHOD = m;
  document.getElementById('payMethods').innerHTML = TS_CONFIG.paymentMethods.map(x =>
    `<button type="button" class="btn ${x.id === m ? 'btn-ink' : 'btn-outline-t'} flex-fill"
       onclick="setMethod('${x.id}')">${x.emoji} ${x.name}</button>`).join('');
  document.getElementById('cashBox').classList.toggle('d-none', m !== 'cash');
  document.getElementById('refBox').classList.toggle('d-none', m === 'cash');
  recalcPay();
}

function recalcPay() {
  const total = payTotal();
  document.getElementById('payTotal').textContent = money(total);
  const got = Number(document.getElementById('cashGot').value) || 0;
  document.getElementById('payChange').textContent = money(Math.max(got - total, 0));
  const quick = [...new Set([total, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, 1000, 2000])]
    .filter(v => v >= total).sort((a, b) => a - b).slice(0, 5);
  document.getElementById('cashQuick').innerHTML = quick.map(v =>
    `<button type="button" class="btn btn-outline-t btn-sm" onclick="document.getElementById('cashGot').value=${v};recalcPay()">
       ${v === total ? 'พอดี ' : ''}${money(v)}</button>`).join('');
}

async function doCheckout() {
  const total = payTotal();
  const err = document.getElementById('payErr');
  const btn = document.getElementById('btnPay');
  let amount = total, reference = '';

  if (X_METHOD === 'cash') {
    amount = Number(document.getElementById('cashGot').value) || 0;
    if (amount < total) { err.textContent = 'รับเงินมาน้อยกว่ายอดบิล'; err.classList.remove('d-none'); return; }
  } else {
    reference = document.getElementById('payRef').value.trim();
  }

  btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
  err.classList.add('d-none');
  try {
    const bill = await API.checkout(X_BILL.id,
      [{ method: X_METHOD, amount, reference }],
      Number(document.getElementById('payDiscount').value) || 0);
    X_BILL = bill;
    bootstrap.Modal.getInstance(document.getElementById('payModal')).hide();
    document.getElementById('receipt').innerHTML = receiptHTML(bill);
    bootstrap.Modal.getOrCreateInstance(document.getElementById('receiptModal')).show();
    toast('ปิดบิลโต๊ะ ' + esc(bill.table_no) + ' แล้ว ✅', 'ok');
    cashLoad();
  } catch (e) {
    err.textContent = e.message; err.classList.remove('d-none');
  } finally {
    btn.disabled = false; btn.textContent = 'ยืนยันรับเงิน';
  }
}

Object.assign(window, {
  cashStart, cashLoad, openBill, printBill, showReceipt, closeReceipt,
  voidTable, openPay, setMethod, recalcPay, doCheckout
});
