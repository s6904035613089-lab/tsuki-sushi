/* =============================================================
   app.js — ฟังก์ชันกลางที่ทุกหน้าใช้ร่วมกัน
   ============================================================= */

const money = n => TS_CONFIG.money(n);
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------------------------------------------------- แจ้งเตือนบนหน้าจอ */
function toast(msg, type = '', ms = 2600) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast-pp ' + type;
  el.innerHTML = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(14px)'; }, ms);
  setTimeout(() => el.remove(), ms + 450);
}

/* ---------------------------------------------------- วันเวลา */
function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}
/** เวลาที่ผ่านไปเป็นนาที */
function minutesSince(iso) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
function agoText(iso) {
  const m = minutesSince(iso);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return m + ' นาทีที่แล้ว';
  return Math.floor(m / 60) + ' ชม. ' + (m % 60) + ' นาที';
}

/* ---------------------------------------------------- แถบเมนูบนสำหรับพนักงาน */
function mountTopbar(active) {
  const el = document.getElementById('topbar');
  if (!el) return;
  const s = API.session();
  const link = (href, label, key, roles) => {
    if (roles && s && s.role !== 'admin' && !roles.includes(s.role)) return '';
    return `<a class="nav-link ${active === key ? 'active' : ''}" href="${href}">${label}</a>`;
  };
  el.innerHTML = `
  <div class="topbar">
    <div class="container d-flex align-items-center gap-3">
      <a class="brand d-flex align-items-center" href="index.html">
        <img src="assets/images/logo.svg" alt="Tsuki Sushi">
      </a>
      <nav class="d-flex align-items-center gap-1 flex-grow-1 overflow-auto">
        ${link('host.html', '🪑 เปิดโต๊ะ / QR', 'host', ['waiter', 'cashier'])}
        ${link('kitchen.html', '👨‍🍳 หน้าครัว', 'kitchen', ['kitchen', 'waiter'])}
        ${link('cashier.html', '💳 แคชเชียร์', 'cashier', ['cashier'])}
        ${s && s.role === 'admin' ? link('admin.html', '⚙️ หลังบ้าน', 'admin') : ''}
      </nav>
      <div class="d-flex align-items-center gap-2 flex-shrink-0">
        ${s ? `<span class="d-none d-md-inline small text-white-50">${esc(s.name)} · ${esc(s.role)}</span>
               <button class="btn btn-ghost btn-sm text-white-50" onclick="doLogout()">ออก</button>`
            : `<a class="btn btn-red btn-sm" href="login.html">เข้าสู่ระบบ</a>`}
      </div>
    </div>
  </div>`;
}

async function doLogout() {
  await API.logout();
  location.href = 'login.html';
}

/* ---------------------------------------------------- ป้ายสถานะ */
function statusTag(map, key) {
  const st = (TS_CONFIG[map] || {})[key] || { label: key, tag: 'tag-new' };
  return `<span class="tag ${st.tag}">${st.label}</span>`;
}

/* ---------------------------------------------------- ใบเสร็จ */
function receiptHTML(bill) {
  const rows = (bill.items || []).map(i => `
    <tr>
      <td>${esc(i.name)}${i.note ? `<div style="font-size:.72rem;color:#666">${esc(i.note)}</div>` : ''}</td>
      <td style="text-align:center;white-space:nowrap">×${i.qty}</td>
      <td style="text-align:right;white-space:nowrap">${money(i.line_total)}</td>
    </tr>`).join('');
  const pays = (bill.payments || []).map(p => {
    const m = TS_CONFIG.paymentMethods.find(x => x.id === p.method);
    return `<div style="display:flex;justify-content:space-between"><span>${m ? m.name : p.method}${p.reference ? ' (' + esc(p.reference) + ')' : ''}</span><span>${money(p.amount)}</span></div>`;
  }).join('');
  const line = (label, val, strong = false) =>
    `<div style="display:flex;justify-content:space-between${strong ? ';font-size:1.1rem;font-weight:600' : ''}"><span>${label}</span><span>${val}</span></div>`;

  return `
  <div style="text-align:center">
    <img src="assets/images/logo-mark.svg" style="height:46px" alt="">
    <div style="font-weight:600;margin-top:4px">${esc(API.setting('shop_name', 'Tsuki Sushi'))}</div>
    <div style="font-size:.78rem;color:#555">${esc(API.setting('shop_address', ''))}</div>
    <div style="font-size:.78rem;color:#555">โทร ${esc(API.setting('shop_phone', '-'))}</div>
    ${API.setting('tax_id', '') ? `<div style="font-size:.78rem;color:#555">เลขผู้เสียภาษี ${esc(API.setting('tax_id', ''))}</div>` : ''}
  </div>
  <div class="receipt-hr"></div>
  ${line('โต๊ะ', '<b>' + esc(bill.table_no) + '</b>')}
  ${line('เลขที่บิล', esc(bill.session_no))}
  ${line('จำนวนลูกค้า', bill.guests + ' ท่าน')}
  ${line('เวลา', fmtDateTime(bill.closed_at || bill.opened_at))}
  <div class="receipt-hr"></div>
  <table><tbody>${rows}</tbody></table>
  <div class="receipt-hr"></div>
  ${line('ยอดอาหาร', money(bill.subtotal))}
  ${Number(bill.service_charge) > 0 ? line(`Service Charge ${bill.service_charge_pct}%`, money(bill.service_charge)) : ''}
  ${Number(bill.vat) > 0 ? line(`VAT ${bill.vat_pct}%`, money(bill.vat)) : ''}
  ${Number(bill.discount) > 0 ? line('ส่วนลด', '−' + money(bill.discount)) : ''}
  ${line('ยอดสุทธิ', money(bill.total), true)}
  ${pays ? `<div class="receipt-hr"></div>${pays}` : ''}
  ${Number(bill.change_amount) > 0 ? line('เงินทอน', money(bill.change_amount)) : ''}
  <div class="receipt-hr"></div>
  <div style="text-align:center;font-size:.8rem;color:#555">${esc(API.setting('receipt_footer', 'ขอบคุณที่มาทานกับเรา 🍣'))}</div>`;
}

Object.assign(window, {
  money, esc, toast, fmtTime, fmtDateTime, minutesSince, agoText,
  mountTopbar, doLogout, statusTag, receiptHTML
});
