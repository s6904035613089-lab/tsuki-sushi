/* =============================================================
   test-schema.mjs — ทดสอบ supabase/schema.sql กับ PostgreSQL จริง
   (ดาวน์โหลด Postgres ชั่วคราวมารันในเครื่อง ไม่แตะฐานข้อมูลจริง)

   ครั้งแรก:  npm install embedded-postgres pg
   รัน:       node tools/test-schema.mjs

   ทดสอบ: สคีมาทั้งไฟล์ → เปิดโต๊ะ → ลูกค้าสั่ง → ครัว → เรียกเก็บเงิน
           → แคชเชียร์ปิดบิล → รายงาน → ข้อความ Telegram
   ============================================================= */
import EmbeddedPostgres from 'embedded-postgres';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, '.pgtest');
rmSync(DATA, { recursive: true, force: true });

/* สภาพแวดล้อมจำลองของ Supabase (auth / storage / pg_net) */
const SHIM = `
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists net;
create extension if not exists pgcrypto;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb default '{}'::jsonb);
create table if not exists storage.buckets (id text primary key, name text, public boolean);
create table if not exists storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
create table if not exists net._http_response (id bigint, status_code int, content text, error_msg text);
create sequence if not exists net.req_seq;
create or replace function net.http_post(url text, body jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $fn$ select nextval('net.req_seq') $fn$;
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select nullif(current_setting('app.uid', true), '')::uuid $fn$;
do $do$ begin create role anon; exception when duplicate_object then null; end $do$;
do $do$ begin create role authenticated; exception when duplicate_object then null; end $do$;
do $do$ begin create publication supabase_realtime; exception when duplicate_object then null; end $do$;
`;

let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  \x1b[32m✔\x1b[0m ' + m); };
const bad  = (m) => { fail++; console.log('  \x1b[31m✘\x1b[0m ' + m); };

const pg = new EmbeddedPostgres({
  databaseDir: DATA, user: 'postgres', password: 'test', port: 54999,
  persistent: false, onLog: () => {}, initdbFlags: ['--encoding=UTF8', '--locale=C']
});

console.log('⏳ เตรียม PostgreSQL ชั่วคราว…');
await pg.initialise();
await pg.start();
const db = pg.getPgClient();
await db.connect();
const as = (uid) => db.query("select set_config('app.uid', $1, false)", [uid || '']);
const mustFail = async (label, fn) => { try { await fn(); bad(label + ' — ทำได้ทั้งที่ไม่ควร'); } catch { ok(label); } };

try {
  await db.query(SHIM);
  const sql = readFileSync(join(ROOT, 'supabase', 'schema.sql'), 'utf8')
    .replace(/create extension if not exists pg_net[^;]*;/i, '-- pg_net (จำลอง)');
  await db.query(sql);
  ok('schema.sql รันผ่านทั้งไฟล์');

  /* ---------- พนักงาน ---------- */
  const { rows: [u] } = await db.query("insert into auth.users (email) values ('chef@tsuki.test') returning id");
  await as(u.id);
  const { rows: [st] } = await db.query('select role from public.staff where id = $1', [u.id]);
  st.role === 'admin' ? ok('ผู้ใช้คนแรกได้สิทธิ์ admin อัตโนมัติ') : bad('สิทธิ์ผิด: ' + st.role);

  /* ---------- ขั้นที่ 1: ผู้ใช้กรอกเลขโต๊ะ + จำนวนคน เองได้โดยไม่ล็อกอิน ---------- */
  await as(null);
  const { rows: [{ list_tables: tl }] } = await db.query('select public.list_tables()');
  (tl.length === 14 && tl.every(t => t.token === undefined))
    ? ok(`list_tables (ไม่ล็อกอิน) เห็น ${tl.length} โต๊ะ และไม่มี token หลุดออกมา`)
    : bad('list_tables ผิด');

  const { rows: [{ open_table: s }] } = await db.query("select public.open_table('A3', 4)");
  ok(`ผู้ใช้ทั่วไปเปิดโต๊ะ ${s.table_no} เองได้ → ${s.session_no}`);
  await mustFail('กันเปิดโต๊ะซ้ำ', () => db.query("select public.open_table('A3', 2)"));
  await mustFail('เปิดโต๊ะที่ไม่มีอยู่จริงไม่ได้', () => db.query("select public.open_table('Z9', 2)"));

  const { rows: [{ table_qr: qr }] } = await db.query("select public.table_qr('A3')");
  qr.token === s.token ? ok('ขอ QR เดิมของโต๊ะที่เปิดอยู่ได้ (ทำ QR หาย)') : bad('table_qr คืน token ผิด');

  const { rows: [{ list_tables: tl2 }] } = await db.query('select public.list_tables()');
  tl2.find(t => t.table_no === 'A3').busy === true ? ok('โต๊ะที่เปิดแล้วขึ้นสถานะไม่ว่าง') : bad('สถานะโต๊ะผิด');
  await as(u.id);

  /* ---------- ลูกค้าสั่งอาหาร (ไม่ล็อกอิน) ---------- */
  const { rows: m } = await db.query("select id from public.menu_items where code in ('N01','A01','B01') order by code");
  await as(null);
  const { rows: [{ place_order: o1 }] } = await db.query('select public.place_order($1,$2::jsonb,$3)',
    [s.token, JSON.stringify([{ menu_item_id: m[0].id, qty: 1 }, { menu_item_id: m[1].id, qty: 2 },
                              { menu_item_id: m[2].id, qty: 3, note: 'ไม่ใส่วาซาบิ' }]), 'เร่งหน่อยนะคะ']);
  ok(`ลูกค้าสั่งอาหารได้โดยไม่ล็อกอิน → ${o1.order_no} (${o1.item_count} ชิ้น ${o1.amount} บาท)`);

  const { rows: [{ session_by_token: v }] } = await db.query('select public.session_by_token($1)', [s.token]);
  v.ok && v.orders.length === 1 ? ok(`ลูกค้าเห็นออเดอร์ตัวเอง · ยอดรวม ${v.session.total}`) : bad('session_by_token ผิด');

  const { rows: [{ place_order: o2 }] } = await db.query('select public.place_order($1,$2::jsonb,$3)',
    [s.token, JSON.stringify([{ menu_item_id: m[0].id, qty: 4 }]), '']);
  o2.round_no === 2 ? ok('สั่งเพิ่มเป็นรอบที่ 2 ได้') : bad('รอบไม่เพิ่ม');

  await mustFail('สั่งด้วย token ปลอมไม่ได้', () =>
    db.query('select public.place_order($1,$2::jsonb,$3)', ['token-มั่ว', JSON.stringify([{ menu_item_id: m[0].id, qty: 1 }]), '']));
  await mustFail('สั่งตะกร้าว่างไม่ได้', () => db.query('select public.place_order($1,$2::jsonb,$3)', [s.token, '[]', '']));

  /* ---------- ของหมด ---------- */
  await as(u.id);
  await db.query('update public.menu_items set available = false where id = $1', [m[0].id]);
  await as(null);
  await mustFail('บล็อกเมนูที่ของหมด', () => db.query('select public.place_order($1,$2::jsonb,$3)',
    [s.token, JSON.stringify([{ menu_item_id: m[0].id, qty: 1 }]), '']));
  await as(u.id);
  await db.query('update public.menu_items set available = true where id = $1', [m[0].id]);

  /* ---------- ครัว ---------- */
  const { rows: ords } = await db.query('select id from public.orders where session_id=$1 order by round_no', [s.id]);
  await db.query("select public.set_order_status($1,'cooking')", [ords[0].id]);
  await db.query("select public.set_order_status($1,'served')", [ords[0].id]);
  const { rows: [c] } = await db.query(
    "select count(*) filter (where status='done') d, count(*) n from public.order_items where order_id=$1", [ords[0].id]);
  c.d === c.n ? ok(`ครัวเปลี่ยนสถานะครบทุกจาน (${c.d}/${c.n})`) : bad('สถานะรายจานไม่ครบ');

  /* ---------- เรียกเก็บเงิน ---------- */
  await as(null);
  const { rows: [{ request_bill: rb }] } = await db.query('select public.request_bill($1)', [s.token]);
  ok(`ลูกค้าเรียกเก็บเงิน → ยอด ${rb.total}`);
  await mustFail('ปิดรับออเดอร์หลังเรียกเก็บเงิน', () => db.query('select public.place_order($1,$2::jsonb,$3)',
    [s.token, JSON.stringify([{ menu_item_id: m[0].id, qty: 1 }]), '']));

  /* ---------- แคชเชียร์ ---------- */
  await as(u.id);
  const { rows: [{ get_bill: bill }] } = await db.query('select public.get_bill($1)', [s.id]);
  const expect = Number(bill.subtotal) + Number(bill.service_charge) + Number(bill.vat) - Number(bill.discount);
  Math.abs(expect - Number(bill.total)) < 0.01
    ? ok(`คิดเงินถูกต้อง: ${bill.subtotal} + service ${bill.service_charge} + vat ${bill.vat} = ${bill.total}`)
    : bad('ยอดรวมไม่ตรง');

  await mustFail('กันจ่ายเงินไม่ครบ', () => db.query('select public.checkout_session($1,$2::jsonb,0)',
    [s.id, JSON.stringify([{ method: 'cash', amount: 10 }])]));

  const { rows: [{ checkout_session: paid }] } = await db.query('select public.checkout_session($1,$2::jsonb,20)',
    [s.id, JSON.stringify([{ method: 'promptpay', amount: 300, reference: 'PP-1' }, { method: 'cash', amount: 2000 }])]);
  ok(`ปิดบิล: สุทธิ ${paid.total} (ลด 20) รับ ${paid.paid_amount} ทอน ${paid.change_amount}`);

  await as(null);
  const { rows: [{ session_by_token: after }] } = await db.query('select public.session_by_token($1)', [s.token]);
  (after.ok === false && after.closed) ? ok('QR เดิมใช้ไม่ได้หลังปิดบิล') : bad('QR ยังใช้ได้หลังปิดบิล');

  await as(u.id);
  await db.query("select public.open_table('A3', 2)");
  ok('เปิดโต๊ะเดิมรอบใหม่ได้หลังปิดบิล');

  /* ---------- ยกเลิกโต๊ะโดยผู้ใช้ทั่วไป ---------- */
  await as(null);
  const { rows: [{ open_table: s3 }] } = await db.query("select public.open_table('A4', 2)");
  await db.query('select public.cancel_session($1, $2)', [s3.id, 'เปิดผิดโต๊ะ']);
  ok('ผู้ใช้ยกเลิกโต๊ะที่ยังไม่ได้สั่งอาหารได้ (เปิดผิดโต๊ะ)');

  const { rows: [{ open_table: s4 }] } = await db.query("select public.open_table('A5', 2)");
  await db.query('select public.place_order($1,$2::jsonb,$3)',
    [s4.token, JSON.stringify([{ menu_item_id: m[0].id, qty: 1 }]), '']);
  await mustFail('ผู้ใช้ยกเลิกโต๊ะที่สั่งอาหารแล้วไม่ได้',
    () => db.query('select public.cancel_session($1, $2)', [s4.id, 'ลอง']));
  await as(u.id);
  await db.query('select public.cancel_session($1, $2)', [s4.id, 'พนักงานยกเลิก']);
  ok('แต่พนักงานยกเลิกได้');

  /* ---------- รายงาน ---------- */
  const { rows: [rep] } = await db.query('select * from public.v_daily_sales');
  Number(rep.bills) === 1 ? ok(`รายงานยอดขาย: ${rep.bills} บิล รายได้ ${rep.revenue}`) : bad('รายงานผิด');
  const { rows: top } = await db.query('select name, qty_sold from public.v_item_sales order by qty_sold desc limit 3');
  ok('เมนูขายดี: ' + top.map(t => `${t.name} ×${t.qty_sold}`).join(', '));

  /* ---------- Telegram ---------- */
  await db.query(`update public.notify_settings set enabled=true, telegram_bot_token='TEST',
    telegram_chat_id='1', notify_order=true, notify_bill=true, notify_payment=true, notify_table=true where id=1`);
  const { rows: [{ open_table: s2 }] } = await db.query("select public.open_table('C1', 6)");
  await as(null);
  await db.query('select public.place_order($1,$2::jsonb,$3)',
    [s2.token, JSON.stringify([{ menu_item_id: m[1].id, qty: 2, note: 'เผ็ดน้อย <b> & "พิเศษ"' }]), '']);
  await db.query('select public.request_bill($1)', [s2.token]);
  await as(u.id);
  await db.query('select public.checkout_session($1,$2::jsonb,0)', [s2.id, JSON.stringify([{ method: 'cash', amount: 1000 }])]);
  const { rows: logs } = await db.query('select event from public.notification_log order by id');
  const events = logs.map(l => l.event).join(',');
  events === 'table,order,bill,payment'
    ? ok('แจ้งเตือน Telegram ครบ 4 เหตุการณ์: ' + events)
    : bad('แจ้งเตือนไม่ครบ: ' + events);
  const { rows: [{ count: rawTags }] } = await db.query(
    `select count(*) from public.notification_log where message ~ '<(?!/?[bi]>)'`);
  Number(rawTags) === 0 ? ok('escape HTML ในข้อความถูกต้อง') : bad('มี HTML ที่ไม่ได้ escape');

} catch (e) {
  bad('ERROR: ' + e.message + (e.position ? ` (ตำแหน่ง ${e.position})` : ''));
} finally {
  await db.end().catch(() => {});
  await pg.stop().catch(() => {});
  rmSync(DATA, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '\x1b[32m✅ ผ่านทั้งหมด' : '\x1b[31m❌ มีข้อผิดพลาด'}\x1b[0m  ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail === 0 ? 0 : 1);
