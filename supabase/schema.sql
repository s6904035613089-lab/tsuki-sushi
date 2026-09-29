-- =============================================================
--  Tsuki Sushi 🌙 — ระบบสั่งอาหารผ่าน QR ที่โต๊ะ
--  Supabase / PostgreSQL schema  (รันทั้งไฟล์ใน SQL Editor → Run)
--  รันซ้ำได้ ปลอดภัย: ใช้ if not exists / or replace ทุกจุด
--
--  ภาพรวมการทำงาน
--   พนักงาน  → open_table('A1', 4)        → ได้ session + token → สร้าง QR
--   ลูกค้า   → สแกน QR → menu.html?t=token → session_by_token / place_order
--   ครัว     → อ่าน orders (realtime) → เปลี่ยนสถานะรายการ
--   แคชเชียร์ → checkout_session(...)      → บันทึกการชำระ ปิดโต๊ะ
--   ทุกขั้น  → แจ้งเตือนเข้า Telegram ผ่าน pg_net
-- =============================================================

create extension if not exists pg_net with schema extensions;

-- ------------------------------------------------------------- ENUM
do $$ begin create type staff_role     as enum ('admin','cashier','kitchen','waiter'); exception when duplicate_object then null; end $$;
do $$ begin create type session_status as enum ('open','billing','paid','cancelled');  exception when duplicate_object then null; end $$;
do $$ begin create type order_status   as enum ('pending','cooking','served','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type item_status    as enum ('pending','cooking','done','cancelled');   exception when duplicate_object then null; end $$;
do $$ begin create type payment_method as enum ('cash','promptpay','transfer','card');     exception when duplicate_object then null; end $$;

-- =============================================================
--  1. staff — พนักงาน (ผูกกับ auth.users)
-- =============================================================
create table if not exists public.staff (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       staff_role not null default 'waiter',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- =============================================================
--  2. categories — หมวดเมนู
-- =============================================================
create table if not exists public.categories (
  id         text primary key,          -- nigiri | maki | sashimi | don | side | noodle | dessert | drink
  name       text not null,
  name_en    text not null default '',
  emoji      text not null default '',
  sort_order int  not null default 0,
  active     boolean not null default true
);

-- =============================================================
--  3. menu_items — เมนูอาหาร
-- =============================================================
create table if not exists public.menu_items (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,               -- N01, M02, …
  name          text not null,
  name_en       text not null default '',
  category_id   text references public.categories(id) on delete set null,
  price         numeric(10,2) not null default 0 check (price >= 0),
  cost          numeric(10,2) not null default 0 check (cost >= 0),
  image_url     text not null default '',
  description   text not null default '',
  prep_minutes  int  not null default 10,           -- เวลาทำโดยประมาณ
  is_raw        boolean not null default false,     -- ของดิบ (เตือนลูกค้า)
  is_spicy      boolean not null default false,
  is_popular    boolean not null default false,
  available     boolean not null default true,      -- ปิดขายชั่วคราวเมื่อของหมด
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists menu_items_cat_idx on public.menu_items(category_id, sort_order);

-- =============================================================
--  4. dining_tables — โต๊ะในร้าน
-- =============================================================
create table if not exists public.dining_tables (
  id         uuid primary key default gen_random_uuid(),
  table_no   text not null unique,       -- A1, A2, B1 …
  seats      int  not null default 4,
  zone       text not null default 'โซนหลัก',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- =============================================================
--  5. table_sessions — รอบการนั่งโต๊ะ (1 QR = 1 session)
-- =============================================================
create table if not exists public.table_sessions (
  id              uuid primary key default gen_random_uuid(),
  session_no      text not null unique,             -- TS260929-0001
  table_id        uuid not null references public.dining_tables(id) on delete restrict,
  token           text not null unique,             -- ใส่ใน QR (สุ่ม เดาไม่ได้)
  guests          int  not null default 1 check (guests > 0),
  status          session_status not null default 'open',
  opened_by       uuid references public.staff(id) on delete set null,
  opened_at       timestamptz not null default now(),
  closed_by       uuid references public.staff(id) on delete set null,
  closed_at       timestamptz,
  bill_requested_at timestamptz,
  subtotal        numeric(12,2) not null default 0,
  service_charge  numeric(12,2) not null default 0,
  vat             numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  paid_amount     numeric(12,2) not null default 0,
  change_amount   numeric(12,2) not null default 0,
  note            text not null default ''
);
create index if not exists sessions_status_idx on public.table_sessions(status, opened_at desc);
create index if not exists sessions_table_idx  on public.table_sessions(table_id, opened_at desc);
/* โต๊ะหนึ่งเปิดได้ครั้งละ 1 session เท่านั้น */
create unique index if not exists sessions_one_open_per_table
  on public.table_sessions(table_id) where status in ('open','billing');

-- =============================================================
--  6. orders — ออเดอร์แต่ละครั้งที่ลูกค้ากดสั่ง (รอบที่ 1, 2, 3 …)
-- =============================================================
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.table_sessions(id) on delete cascade,
  order_no     text not null,                -- TS260929-0001#2  (session + รอบ)
  round_no     int  not null default 1,
  status       order_status not null default 'pending',
  item_count   int  not null default 0,
  amount       numeric(12,2) not null default 0,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  served_at    timestamptz
);
create index if not exists orders_session_idx on public.orders(session_id, round_no);
create index if not exists orders_status_idx  on public.orders(status, created_at);

-- =============================================================
--  7. order_items — รายการอาหารในออเดอร์ (snapshot ชื่อ/ราคา)
-- =============================================================
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  session_id   uuid not null references public.table_sessions(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete set null,
  code         text not null default '',
  name         text not null,
  unit_price   numeric(10,2) not null,
  unit_cost    numeric(10,2) not null default 0,
  qty          int not null check (qty > 0),
  line_total   numeric(12,2) not null,
  status       item_status not null default 'pending',
  note         text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists order_items_order_idx   on public.order_items(order_id);
create index if not exists order_items_session_idx on public.order_items(session_id);

-- =============================================================
--  8. payments — การรับชำระ (จ่ายหลายช่องทางในบิลเดียวได้)
-- =============================================================
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  method     payment_method not null,
  amount     numeric(12,2) not null check (amount >= 0),
  reference  text not null default '',
  staff_id   uuid references public.staff(id) on delete set null,
  paid_at    timestamptz not null default now()
);
create index if not exists payments_session_idx on public.payments(session_id);

-- =============================================================
--  9. settings / notify_settings / notification_log
-- =============================================================
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.notify_settings (
  id                 int primary key default 1 check (id = 1),
  enabled            boolean not null default false,
  telegram_bot_token text not null default '',
  telegram_chat_id   text not null default '',
  notify_order       boolean not null default true,   -- ลูกค้าสั่งอาหาร
  notify_bill        boolean not null default true,   -- เรียกเก็บเงิน
  notify_payment     boolean not null default true,   -- ชำระเงินสำเร็จ
  notify_table       boolean not null default false,  -- เปิดโต๊ะใหม่
  updated_at         timestamptz not null default now()
);
insert into public.notify_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.notification_log (
  id         bigserial primary key,
  event      text not null,       -- table | order | bill | payment | test
  message    text not null,
  request_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists notification_log_created_idx on public.notification_log(created_at desc);

-- =============================================================
--  Helper: updated_at / สิทธิ์ / เลขที่เอกสาร
-- =============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_menu_updated on public.menu_items;
create trigger trg_menu_updated before update on public.menu_items
  for each row execute function public.set_updated_at();

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and active);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and active and role = 'admin');
$$;

create sequence if not exists public.session_no_seq;

create or replace function public.next_session_no()
returns text language sql volatile as $$
  select 'TS' || to_char(now() at time zone 'Asia/Bangkok', 'YYMMDD') || '-' ||
         lpad(nextval('public.session_no_seq')::text, 4, '0');
$$;

/** โทเคนสำหรับ QR — สุ่ม 20 ตัวอักษร (hex ≈ 80 bit) เดาไม่ได้
    ใช้ gen_random_uuid() ซึ่งเป็นฟังก์ชันแกนของ PostgreSQL 13+
    (ไม่พึ่ง pgcrypto เพราะบน Supabase อยู่คนละ schema กับ search_path ของฟังก์ชันนี้) */
create or replace function public.new_token()
returns text language sql volatile as $$
  select substr(replace(gen_random_uuid()::text, '-', '') ||
                replace(gen_random_uuid()::text, '-', ''), 1, 20);
$$;

/* สร้างแถว staff อัตโนมัติเมื่อมีผู้ใช้ใหม่ (คนแรก = admin) */
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.staff (id, email, full_name, role)
  values (new.id, coalesce(new.email, ''),
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
          case when (select count(*) from public.staff) = 0 then 'admin'::staff_role else 'waiter'::staff_role end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

/* อ่านค่า settings เป็นตัวเลข */
create or replace function public.setting_num(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = p_key), p_default);
$$;

-- =============================================================
--  Telegram — ฐานข้อมูลส่งข้อความเอง (pg_net)
-- =============================================================
create or replace function public.tg_esc(t text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(t,''), '&','&amp;'), '<','&lt;'), '>','&gt;');
$$;

create or replace function public.tg_money(n numeric)
returns text language sql immutable as $$
  select '฿' || to_char(coalesce(n,0), 'FM999,999,990.00');
$$;

create or replace function public.telegram_send(p_event text, p_text text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare s public.notify_settings; v_req bigint;
begin
  select * into s from public.notify_settings where id = 1;
  if s.id is null or not s.enabled or s.telegram_bot_token = '' or s.telegram_chat_id = '' then return null; end if;
  begin
    select net.http_post(
      url     := 'https://api.telegram.org/bot' || s.telegram_bot_token || '/sendMessage',
      body    := jsonb_build_object('chat_id', s.telegram_chat_id, 'text', p_text,
                                    'parse_mode','HTML', 'disable_web_page_preview', true),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 8000
    ) into v_req;
  exception when others then v_req := null;    -- ห้ามให้การแจ้งเตือนทำให้ออเดอร์ล้ม
  end;
  insert into public.notification_log (event, message, request_id) values (p_event, p_text, v_req);
  return v_req;
end $$;

create or replace function public.telegram_test()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_req bigint; s public.notify_settings;
begin
  if not public.is_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into s from public.notify_settings where id = 1;
  if not s.enabled then raise exception 'ยังไม่ได้เปิดใช้งาน (ติ๊กเปิดใช้งานแล้วบันทึกก่อน)'; end if;
  if s.telegram_bot_token = '' or s.telegram_chat_id = '' then raise exception 'กรุณากรอก Bot Token และ Chat ID'; end if;
  v_req := public.telegram_send('test',
    '🔔 <b>ทดสอบการแจ้งเตือน Tsuki Sushi</b>' || E'\n' || 'ตั้งค่าถูกต้องแล้ว 🍣' || E'\n' ||
    to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI'));
  if v_req is null then raise exception 'ส่งไม่สำเร็จ — ตรวจสอบ extension pg_net'; end if;
  return v_req;
end $$;

create or replace function public.telegram_check(p_request_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  select status_code, content, error_msg into r from net._http_response where id = p_request_id;
  if r is null then return jsonb_build_object('done', false); end if;
  return jsonb_build_object('done', true, 'status', r.status_code,
                            'body', left(coalesce(r.content,''), 400), 'error', r.error_msg);
end $$;

-- =============================================================
--  คำนวณยอดของ session (ไม่รวมรายการที่ยกเลิก)
-- =============================================================
create or replace function public.recalc_session(p_session_id uuid)
returns public.table_sessions language plpgsql security definer set search_path = public as $$
declare v public.table_sessions; v_sub numeric; v_svc numeric; v_vat numeric;
        v_svc_pct numeric := public.setting_num('service_charge_pct', 10);
        v_vat_pct numeric := public.setting_num('vat_pct', 7);
begin
  select coalesce(sum(line_total), 0) into v_sub
    from public.order_items where session_id = p_session_id and status <> 'cancelled';
  select * into strict v from public.table_sessions where id = p_session_id;
  v_svc := round(v_sub * v_svc_pct / 100, 2);
  v_vat := round((v_sub + v_svc) * v_vat_pct / 100, 2);
  update public.table_sessions set
    subtotal = v_sub, service_charge = v_svc, vat = v_vat,
    total = greatest(v_sub + v_svc + v_vat - discount, 0)
  where id = p_session_id returning * into v;
  return v;
end $$;

-- =============================================================
--  รายชื่อโต๊ะ + สถานะว่าง/ไม่ว่าง (เปิดให้ทุกคนอ่าน — ใช้ในหน้าสร้าง QR)
--  ไม่คืน token เพื่อไม่ให้ดึง QR ของโต๊ะอื่นไปใช้
-- =============================================================
create or replace function public.list_tables()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'table_no', t.table_no, 'seats', t.seats, 'zone', t.zone,
           'busy',       s.id is not null,
           'session_no', s.session_no,
           'guests',     s.guests,
           'status',     s.status,
           'opened_at',  s.opened_at,
           'has_orders', coalesce(s.item_cnt, 0) > 0
         ) order by t.table_no), '[]'::jsonb)
    from public.dining_tables t
    left join lateral (
      select ts.*, (select count(*) from public.order_items oi where oi.session_id = ts.id) as item_cnt
        from public.table_sessions ts
       where ts.table_id = t.id and ts.status in ('open','billing')
       limit 1
    ) s on true
   where t.active;
$$;

/** ขอ QR ของโต๊ะที่เปิดอยู่แล้ว (กรณีทำ QR หาย / อยากพิมพ์ใหม่) */
create or replace function public.table_qr(p_table_no text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t public.dining_tables; v public.table_sessions;
begin
  select * into t from public.dining_tables where upper(table_no) = upper(trim(p_table_no));
  if t.id is null then raise exception 'ไม่พบโต๊ะ %', p_table_no; end if;
  select * into v from public.table_sessions
   where table_id = t.id and status in ('open','billing') limit 1;
  if v.id is null then raise exception 'โต๊ะ % ยังไม่ได้เปิด', t.table_no; end if;
  return jsonb_build_object('id', v.id, 'token', v.token, 'session_no', v.session_no,
                            'guests', v.guests, 'opened_at', v.opened_at, 'status', v.status,
                            'table_no', t.table_no, 'zone', t.zone);
end $$;

-- =============================================================
--  เปิดโต๊ะ — กรอกเลขโต๊ะ + จำนวนคน แล้วได้ token ไปสร้าง QR
--  เปิดให้ใช้ได้โดยไม่ต้องล็อกอิน (ถ้าพนักงานล็อกอินอยู่จะบันทึกว่าใครเปิด)
-- =============================================================
create or replace function public.open_table(p_table_no text, p_guests int default 2)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_table public.dining_tables; v public.table_sessions; s public.notify_settings;
begin
  select * into v_table from public.dining_tables where upper(table_no) = upper(trim(p_table_no));
  if v_table.id is null then raise exception 'ไม่พบโต๊ะ %', p_table_no; end if;
  if not v_table.active then raise exception 'โต๊ะ % ปิดใช้งานอยู่', v_table.table_no; end if;
  if p_guests is null or p_guests < 1 then raise exception 'กรุณาระบุจำนวนคน'; end if;

  select * into v from public.table_sessions
   where table_id = v_table.id and status in ('open','billing') limit 1;
  if v.id is not null then
    raise exception 'โต๊ะ % กำลังใช้งานอยู่ (%) — ปิดโต๊ะก่อนหรือใช้ QR เดิม', v_table.table_no, v.session_no;
  end if;

  insert into public.table_sessions (session_no, table_id, token, guests, opened_by)
  values (public.next_session_no(), v_table.id, public.new_token(), p_guests, auth.uid())
  returning * into v;

  select * into s from public.notify_settings where id = 1;
  if s.enabled and s.notify_table then
    perform public.telegram_send('table',
      '🪑 <b>เปิดโต๊ะ ' || tg_esc(v_table.table_no) || '</b>' || E'\n' ||
      'บิล ' || tg_esc(v.session_no) || ' · ' || v.guests || ' ท่าน');
  end if;

  return to_jsonb(v) || jsonb_build_object('table_no', v_table.table_no, 'zone', v_table.zone, 'seats', v_table.seats);
end $$;

/* ปิดโต๊ะโดยไม่คิดเงิน (ยกเลิก)
   พนักงาน: ยกเลิกได้เสมอ · คนทั่วไป: ยกเลิกได้เฉพาะโต๊ะที่ยังไม่มีรายการสั่ง (เปิดผิดโต๊ะ) */
create or replace function public.cancel_session(p_session_id uuid, p_reason text default '')
returns public.table_sessions language plpgsql security definer set search_path = public as $$
declare v public.table_sessions;
begin
  select * into v from public.table_sessions where id = p_session_id and status in ('open','billing');
  if v.id is null then raise exception 'ไม่พบโต๊ะที่เปิดอยู่'; end if;
  if not public.is_staff()
     and exists (select 1 from public.order_items where session_id = v.id and status <> 'cancelled') then
    raise exception 'โต๊ะนี้มีรายการสั่งอาหารแล้ว กรุณาเรียกพนักงานค่ะ';
  end if;

  update public.table_sessions
     set status = 'cancelled', closed_by = auth.uid(), closed_at = now(),
         note = case when p_reason <> '' then p_reason else note end
   where id = p_session_id
   returning * into v;
  update public.order_items set status = 'cancelled' where session_id = v.id and status <> 'done';
  update public.orders set status = 'cancelled' where session_id = v.id and status <> 'served';
  return v;
end $$;

-- =============================================================
--  ฝั่งลูกค้า (anon) — ทุกอย่างผ่าน token เท่านั้น
-- =============================================================
/** ข้อมูลโต๊ะ + ออเดอร์ทั้งหมดของ session นี้ (ใช้ในหน้าลูกค้า) */
create or replace function public.session_by_token(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.table_sessions; v_table public.dining_tables;
begin
  select * into v from public.table_sessions where token = p_token;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'ไม่พบโต๊ะนี้ — QR อาจหมดอายุแล้ว'); end if;
  select * into v_table from public.dining_tables where id = v.table_id;
  if v.status in ('paid','cancelled') then
    return jsonb_build_object('ok', false, 'closed', true, 'table_no', v_table.table_no,
                              'error', 'โต๊ะนี้ปิดบิลแล้ว ขอบคุณที่ใช้บริการค่ะ 🙏');
  end if;
  return jsonb_build_object(
    'ok', true,
    'session', jsonb_build_object(
      'id', v.id, 'session_no', v.session_no, 'status', v.status, 'guests', v.guests,
      'opened_at', v.opened_at, 'table_no', v_table.table_no, 'zone', v_table.zone,
      'subtotal', v.subtotal, 'service_charge', v.service_charge, 'vat', v.vat,
      'discount', v.discount, 'total', v.total),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_no', o.order_no, 'round_no', o.round_no, 'status', o.status,
               'created_at', o.created_at, 'amount', o.amount,
               'items', (select jsonb_agg(jsonb_build_object(
                           'name', i.name, 'code', i.code, 'qty', i.qty,
                           'unit_price', i.unit_price, 'line_total', i.line_total,
                           'status', i.status, 'note', i.note) order by i.created_at)
                         from public.order_items i where i.order_id = o.id))
             order by o.round_no)
      from public.orders o where o.session_id = v.id and o.status <> 'cancelled'), '[]'::jsonb),
    'service_charge_pct', public.setting_num('service_charge_pct', 10),
    'vat_pct', public.setting_num('vat_pct', 7)
  );
end $$;

/** ลูกค้าสั่งอาหาร — items = [{ menu_item_id, qty, note }] */
create or replace function public.place_order(p_token text, p_items jsonb, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v        public.table_sessions;
  v_table  public.dining_tables;
  v_order  public.orders;
  v_item   jsonb;
  m        public.menu_items;
  v_qty    int;
  v_round  int;
  v_count  int := 0;
  v_amount numeric := 0;
  v_lines  text := '';
  s        public.notify_settings;
begin
  select * into v from public.table_sessions where token = p_token for update;
  if v.id is null then raise exception 'ไม่พบโต๊ะนี้ — QR อาจหมดอายุแล้ว'; end if;
  if v.status <> 'open' then raise exception 'โต๊ะนี้ปิดรับออเดอร์แล้ว (กำลังเก็บเงิน)'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'ตะกร้าว่าง'; end if;

  select coalesce(max(round_no), 0) + 1 into v_round from public.orders where session_id = v.id;
  select * into v_table from public.dining_tables where id = v.table_id;

  insert into public.orders (session_id, order_no, round_no, note)
  values (v.id, v.session_no || '#' || v_round, v_round, coalesce(p_note, ''))
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(coalesce((v_item ->> 'qty')::int, 0), 0);
    if v_qty = 0 then continue; end if;
    if v_qty > 99 then raise exception 'จำนวนต่อรายการต้องไม่เกิน 99'; end if;

    select * into m from public.menu_items where id = (v_item ->> 'menu_item_id')::uuid;
    if m.id is null then raise exception 'ไม่พบเมนูที่เลือก'; end if;
    if not m.available then raise exception 'ขออภัย "%" หมดชั่วคราวค่ะ', m.name; end if;

    insert into public.order_items (order_id, session_id, menu_item_id, code, name,
                                    unit_price, unit_cost, qty, line_total, note)
    values (v_order.id, v.id, m.id, m.code, m.name, m.price, m.cost, v_qty, m.price * v_qty,
            left(coalesce(v_item ->> 'note', ''), 200));

    v_count  := v_count + v_qty;
    v_amount := v_amount + m.price * v_qty;
    v_lines  := v_lines || E'\n' || '• ' || tg_esc(m.name) || ' ×' || v_qty ||
                case when coalesce(v_item ->> 'note','') <> '' then '  <i>(' || tg_esc(v_item ->> 'note') || ')</i>' else '' end;
  end loop;

  if v_count = 0 then raise exception 'ตะกร้าว่าง'; end if;

  update public.orders set item_count = v_count, amount = v_amount
   where id = v_order.id returning * into v_order;
  perform public.recalc_session(v.id);

  select * into s from public.notify_settings where id = 1;
  if s.enabled and s.notify_order then
    perform public.telegram_send('order',
      '🍣 <b>ออเดอร์ใหม่ — โต๊ะ ' || tg_esc(v_table.table_no) || '</b>' || E'\n' ||
      tg_esc(v_order.order_no) || ' (รอบที่ ' || v_round || ') · ' || v.guests || ' ท่าน' ||
      v_lines || E'\n' || '━━━━━━━━━━━━' || E'\n' ||
      'รวม ' || v_count || ' รายการ  ' || tg_money(v_amount) ||
      case when coalesce(p_note,'') <> '' then E'\n' || '📝 ' || tg_esc(p_note) else '' end);
  end if;

  return jsonb_build_object('ok', true, 'order_no', v_order.order_no, 'round_no', v_round,
                            'item_count', v_count, 'amount', v_amount);
end $$;

/** ลูกค้ากดเรียกเก็บเงิน */
create or replace function public.request_bill(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.table_sessions; v_table public.dining_tables; s public.notify_settings;
begin
  select * into v from public.table_sessions where token = p_token;
  if v.id is null then raise exception 'ไม่พบโต๊ะนี้'; end if;
  if v.status = 'billing' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v.status <> 'open' then raise exception 'โต๊ะนี้ปิดบิลแล้ว'; end if;
  if not exists (select 1 from public.order_items where session_id = v.id and status <> 'cancelled') then
    raise exception 'ยังไม่มีรายการอาหาร';
  end if;

  v := public.recalc_session(v.id);
  update public.table_sessions set status = 'billing', bill_requested_at = now()
   where id = v.id returning * into v;
  select * into v_table from public.dining_tables where id = v.table_id;

  select * into s from public.notify_settings where id = 1;
  if s.enabled and s.notify_bill then
    perform public.telegram_send('bill',
      '💳 <b>เรียกเก็บเงิน — โต๊ะ ' || tg_esc(v_table.table_no) || '</b>' || E'\n' ||
      tg_esc(v.session_no) || ' · ' || v.guests || ' ท่าน' || E'\n' ||
      'ยอดสุทธิ <b>' || tg_money(v.total) || '</b>' || E'\n' ||
      '👉 ไปที่หน้าแคชเชียร์เพื่อรับชำระเงิน');
  end if;
  return jsonb_build_object('ok', true, 'total', v.total);
end $$;

-- =============================================================
--  ฝั่งครัว / แคชเชียร์ (พนักงาน)
-- =============================================================
/** เปลี่ยนสถานะทั้งออเดอร์ (ครัวกดรับ / เสิร์ฟแล้ว) */
create or replace function public.set_order_status(p_order_id uuid, p_status order_status)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v public.orders;
begin
  if not public.is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  update public.orders set
    status = p_status,
    accepted_at = case when p_status = 'cooking' and accepted_at is null then now() else accepted_at end,
    served_at   = case when p_status = 'served'  and served_at   is null then now() else served_at end
  where id = p_order_id returning * into v;
  if v.id is null then raise exception 'ไม่พบออเดอร์'; end if;

  update public.order_items set status =
    case p_status when 'cooking' then 'cooking'::item_status
                  when 'served'  then 'done'::item_status
                  when 'cancelled' then 'cancelled'::item_status
                  else status end
   where order_id = p_order_id and status <> 'cancelled';

  if p_status = 'cancelled' then perform public.recalc_session(v.session_id); end if;
  return v;
end $$;

/** เปลี่ยนสถานะรายการเดียว (เช่น ของหมดต้องยกเลิกบางจาน) */
create or replace function public.set_item_status(p_item_id uuid, p_status item_status)
returns public.order_items language plpgsql security definer set search_path = public as $$
declare v public.order_items;
begin
  if not public.is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  update public.order_items set status = p_status where id = p_item_id returning * into v;
  if v.id is null then raise exception 'ไม่พบรายการ'; end if;
  /* ถ้าทุกรายการในออเดอร์เสร็จหมด → ออเดอร์เสิร์ฟแล้ว */
  update public.orders o set status = 'served', served_at = coalesce(o.served_at, now())
   where o.id = v.order_id and o.status <> 'cancelled'
     and not exists (select 1 from public.order_items i
                      where i.order_id = o.id and i.status not in ('done','cancelled'));
  perform public.recalc_session(v.session_id);
  return v;
end $$;

/** บิลเต็มของโต๊ะ (ใช้ที่หน้าแคชเชียร์และพิมพ์ใบเสร็จ) */
create or replace function public.get_bill(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.table_sessions; v_table public.dining_tables;
begin
  if not public.is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into v from public.table_sessions where id = p_session_id;
  if v.id is null then raise exception 'ไม่พบบิล'; end if;
  select * into v_table from public.dining_tables where id = v.table_id;
  return to_jsonb(v) || jsonb_build_object(
    'table_no', v_table.table_no, 'zone', v_table.zone,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', name, 'code', code, 'qty', qty, 'unit_price', unit_price,
        'line_total', line_total, 'status', status, 'note', note) order by created_at)
      from public.order_items where session_id = v.id and status <> 'cancelled'), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'method', method, 'amount', amount, 'reference', reference, 'paid_at', paid_at) order by paid_at)
      from public.payments where session_id = v.id), '[]'::jsonb),
    'service_charge_pct', public.setting_num('service_charge_pct', 10),
    'vat_pct', public.setting_num('vat_pct', 7));
end $$;

/** รับชำระเงินและปิดโต๊ะ — payments = [{method, amount, reference}] */
create or replace function public.checkout_session(p_session_id uuid, p_payments jsonb, p_discount numeric default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.table_sessions; v_table public.dining_tables; v_pay jsonb;
        v_paid numeric := 0; s public.notify_settings; v_methods text := '';
begin
  if not public.is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into v from public.table_sessions where id = p_session_id for update;
  if v.id is null then raise exception 'ไม่พบบิล'; end if;
  if v.status = 'paid' then raise exception 'บิลนี้ชำระเงินแล้ว'; end if;
  if v.status = 'cancelled' then raise exception 'บิลนี้ถูกยกเลิกแล้ว'; end if;

  update public.table_sessions set discount = greatest(coalesce(p_discount, 0), 0) where id = v.id;
  v := public.recalc_session(v.id);

  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    insert into public.payments (session_id, method, amount, reference, staff_id)
    values (v.id, (v_pay ->> 'method')::payment_method, coalesce((v_pay ->> 'amount')::numeric, 0),
            coalesce(v_pay ->> 'reference', ''), auth.uid());
    v_paid   := v_paid + coalesce((v_pay ->> 'amount')::numeric, 0);
    v_methods := v_methods || case when v_methods = '' then '' else ', ' end ||
                 case v_pay ->> 'method' when 'cash' then 'เงินสด' when 'promptpay' then 'พร้อมเพย์'
                      when 'transfer' then 'โอน' when 'card' then 'บัตร' else v_pay ->> 'method' end ||
                 ' ' || tg_money(coalesce((v_pay ->> 'amount')::numeric, 0));
  end loop;
  if v_paid < v.total then raise exception 'ยอดชำระ % น้อยกว่ายอดบิล %', v_paid, v.total; end if;

  update public.table_sessions set
    status = 'paid', paid_amount = v_paid, change_amount = v_paid - v.total,
    closed_by = auth.uid(), closed_at = now()
  where id = v.id returning * into v;

  update public.order_items set status = 'done' where session_id = v.id and status not in ('done','cancelled');
  update public.orders set status = 'served', served_at = coalesce(served_at, now())
   where session_id = v.id and status <> 'cancelled';

  select * into v_table from public.dining_tables where id = v.table_id;
  select * into s from public.notify_settings where id = 1;
  if s.enabled and s.notify_payment then
    perform public.telegram_send('payment',
      '✅ <b>ชำระเงินแล้ว — โต๊ะ ' || tg_esc(v_table.table_no) || '</b>' || E'\n' ||
      tg_esc(v.session_no) || ' · ' || v.guests || ' ท่าน' || E'\n' ||
      'ยอดอาหาร ' || tg_money(v.subtotal) || E'\n' ||
      case when v.service_charge > 0 then 'Service ' || tg_money(v.service_charge) || E'\n' else '' end ||
      case when v.vat > 0 then 'VAT ' || tg_money(v.vat) || E'\n' else '' end ||
      case when v.discount > 0 then 'ส่วนลด −' || tg_money(v.discount) || E'\n' else '' end ||
      '💰 <b>สุทธิ ' || tg_money(v.total) || '</b>' || E'\n' ||
      '💳 ' || v_methods ||
      case when v.change_amount > 0 then E'\n' || 'เงินทอน ' || tg_money(v.change_amount) else '' end);
  end if;

  return public.get_bill(v.id);
end $$;

-- =============================================================
--  Views สำหรับรายงาน
-- =============================================================
create or replace view public.v_daily_sales with (security_invoker = true) as
  select (closed_at at time zone 'Asia/Bangkok')::date as day,
         count(*) as bills, sum(guests) as guests,
         sum(subtotal) as food_sales, sum(service_charge) as service, sum(vat) as vat, sum(total) as revenue
    from public.table_sessions where status = 'paid'
   group by 1;

create or replace view public.v_item_sales with (security_invoker = true) as
  select i.code, i.name, sum(i.qty) as qty_sold, sum(i.line_total) as revenue,
         sum(i.line_total - i.unit_cost * i.qty) as gross_profit
    from public.order_items i
    join public.table_sessions s on s.id = i.session_id
   where s.status = 'paid' and i.status <> 'cancelled'
   group by 1, 2;

-- =============================================================
--  Row Level Security
-- =============================================================
alter table public.staff            enable row level security;
alter table public.categories       enable row level security;
alter table public.menu_items       enable row level security;
alter table public.dining_tables    enable row level security;
alter table public.table_sessions   enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.payments         enable row level security;
alter table public.settings         enable row level security;
alter table public.notify_settings  enable row level security;
alter table public.notification_log enable row level security;

drop policy if exists "staff read"            on public.staff;
drop policy if exists "staff admin write"     on public.staff;
drop policy if exists "categories read"       on public.categories;
drop policy if exists "categories write"      on public.categories;
drop policy if exists "menu read"             on public.menu_items;
drop policy if exists "menu write"            on public.menu_items;
drop policy if exists "tables staff"          on public.dining_tables;
drop policy if exists "sessions staff"        on public.table_sessions;
drop policy if exists "orders staff"          on public.orders;
drop policy if exists "order_items staff"     on public.order_items;
drop policy if exists "payments staff"        on public.payments;
drop policy if exists "settings read"         on public.settings;
drop policy if exists "settings admin write"  on public.settings;
drop policy if exists "notify admin"          on public.notify_settings;
drop policy if exists "notify log staff"      on public.notification_log;

/* เมนู หมวด และการตั้งค่าร้าน — ลูกค้าอ่านได้ (ไม่ต้องล็อกอิน) */
create policy "categories read"  on public.categories for select using (true);
create policy "categories write" on public.categories for all using (public.is_staff()) with check (public.is_staff());
create policy "menu read"        on public.menu_items for select using (true);
create policy "menu write"       on public.menu_items for all using (public.is_staff()) with check (public.is_staff());
create policy "settings read"        on public.settings for select using (true);
create policy "settings admin write" on public.settings for all using (public.is_admin()) with check (public.is_admin());

/* ข้อมูลการขาย — พนักงานเท่านั้น (ลูกค้าเข้าถึงผ่าน RPC ที่ใช้ token) */
create policy "staff read"        on public.staff          for select using (public.is_staff());
create policy "staff admin write" on public.staff          for all    using (public.is_admin()) with check (public.is_admin());
create policy "tables staff"      on public.dining_tables  for all using (public.is_staff()) with check (public.is_staff());
create policy "sessions staff"    on public.table_sessions for all using (public.is_staff()) with check (public.is_staff());
create policy "orders staff"      on public.orders         for all using (public.is_staff()) with check (public.is_staff());
create policy "order_items staff" on public.order_items    for all using (public.is_staff()) with check (public.is_staff());
create policy "payments staff"    on public.payments       for all using (public.is_staff()) with check (public.is_staff());
create policy "notify admin"      on public.notify_settings for all using (public.is_admin()) with check (public.is_admin());
create policy "notify log staff"  on public.notification_log for select using (public.is_staff());

/* สิทธิ์เรียก function */
grant execute on function public.session_by_token(text)            to anon, authenticated;
grant execute on function public.place_order(text, jsonb, text)    to anon, authenticated;
grant execute on function public.request_bill(text)                to anon, authenticated;
grant execute on function public.list_tables()                     to anon, authenticated;
grant execute on function public.table_qr(text)                    to anon, authenticated;
grant execute on function public.open_table(text, int)             to anon, authenticated;
grant execute on function public.cancel_session(uuid, text)        to anon, authenticated;
grant execute on function public.set_order_status(uuid, order_status) to authenticated;
grant execute on function public.set_item_status(uuid, item_status)   to authenticated;
grant execute on function public.get_bill(uuid)                    to authenticated;
grant execute on function public.checkout_session(uuid, jsonb, numeric) to authenticated;
grant execute on function public.telegram_test()                   to authenticated;
grant execute on function public.telegram_check(bigint)            to authenticated;
grant select on public.v_daily_sales, public.v_item_sales          to authenticated;

revoke execute on function public.telegram_send(text, text)  from anon, authenticated, public;
revoke execute on function public.recalc_session(uuid)       from anon, authenticated, public;
revoke execute on function public.get_bill(uuid)             from anon;
revoke all on public.v_daily_sales, public.v_item_sales      from anon;

/* Realtime สำหรับหน้าจอครัว */
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.order_items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.table_sessions;
exception when duplicate_object then null; end $$;

-- =============================================================
--  Storage — bucket รูปเมนู
-- =============================================================
insert into storage.buckets (id, name, public) values ('menu-images','menu-images', true)
on conflict (id) do nothing;
drop policy if exists "menu images read"  on storage.objects;
drop policy if exists "menu images write" on storage.objects;
create policy "menu images read"  on storage.objects for select using (bucket_id = 'menu-images');
create policy "menu images write" on storage.objects for all
  using (bucket_id = 'menu-images' and public.is_staff())
  with check (bucket_id = 'menu-images' and public.is_staff());

-- =============================================================
--  Seed — ข้อมูลตั้งต้น
-- =============================================================
insert into public.settings (key, value) values
  ('shop_name',          '"Tsuki Sushi 🌙"'),
  ('shop_address',       '"123 ถนนสุขุมวิท กรุงเทพฯ 10110"'),
  ('shop_phone',         '"02-123-4567"'),
  ('tax_id',             '""'),
  ('service_charge_pct', '10'),
  ('vat_pct',            '7'),
  ('promptpay_id',       '""'),
  ('receipt_footer',     '"ขอบคุณที่มาทานกับเรา 🍣 แล้วพบกันใหม่นะคะ"')
on conflict (key) do nothing;

insert into public.categories (id, name, name_en, emoji, sort_order) values
  ('nigiri',  'ซูชิหน้าปลา', 'Nigiri',  '🍣', 1),
  ('maki',    'มากิ / โรล',  'Maki Roll','🍙', 2),
  ('sashimi', 'ซาชิมิ',      'Sashimi', '🐟', 3),
  ('don',     'ข้าวหน้าต่างๆ','Donburi', '🍚', 4),
  ('side',    'ทานเล่น',     'Side Dish','🍤', 5),
  ('noodle',  'ราเมน / อุด้ง','Noodle',  '🍜', 6),
  ('dessert', 'ของหวาน',     'Dessert', '🍡', 7),
  ('drink',   'เครื่องดื่ม',  'Drink',   '🍵', 8)
on conflict (id) do update set name = excluded.name, name_en = excluded.name_en,
  emoji = excluded.emoji, sort_order = excluded.sort_order;

insert into public.menu_items (code, name, name_en, category_id, price, cost, image_url, description, prep_minutes, is_raw, is_spicy, is_popular, sort_order) values
  ('N01','ซูชิแซลมอน','Salmon Nigiri','nigiri',59,22,'assets/images/menu/salmon-nigiri.svg','แซลมอนนอร์เวย์สดใหม่ ตัดหนา วางบนข้าวปั้นอุ่น ๆ',5,true,false,true,1),
  ('N02','ซูชิทูน่า','Tuna Nigiri','nigiri',69,28,'assets/images/menu/tuna-nigiri.svg','อาคามิเนื้อแน่น รสสะอาด หวานละมุนปลายลิ้น',5,true,false,false,2),
  ('N03','ซูชิฮามาจิ','Hamachi Nigiri','nigiri',79,34,'assets/images/menu/hamachi-nigiri.svg','ปลาหางเหลืองญี่ปุ่น มันกำลังดี หอมกลิ่นทะเล',5,true,false,false,3),
  ('N04','ซูชิกุ้ง','Ebi Nigiri','nigiri',49,18,'assets/images/menu/ebi-nigiri.svg','กุ้งต้มหวานกรอบ เหมาะกับเด็ก ๆ และคนไม่ทานดิบ',5,false,false,false,4),
  ('N05','ซูชิไข่หวาน','Tamago Nigiri','nigiri',35,10,'assets/images/menu/tamago-nigiri.svg','ไข่ม้วนญี่ปุ่นนุ่มหวาน รัดด้วยสาหร่ายกรอบ',5,false,false,false,5),
  ('N06','ซูชิปลาไหล','Unagi Nigiri','nigiri',89,40,'assets/images/menu/unagi-nigiri.svg','ปลาไหลย่างซอสคาบายากิ หอมไฟ หวานเค็มกลมกล่อม',8,false,false,true,6),
  ('N07','แซลมอนย่างไฟ','Aburi Salmon','nigiri',69,26,'assets/images/menu/aburi-salmon.svg','แซลมอนลนไฟหอม ๆ ราดซอสมายองเนสสูตรร้าน',7,false,false,true,7),
  ('N08','ซูชิเอนกาวะ','Engawa Nigiri','nigiri',79,33,'assets/images/menu/engawa-nigiri.svg','ครีบปลาฮิราเมะ เคี้ยวหนึบ มันปลาละลายในปาก',5,true,false,false,8),

  ('M01','แคลิฟอร์เนียโรล','California Roll','maki',129,48,'assets/images/menu/california-roll.svg','ปูอัด อะโวคาโด แตงกวา คลุกไข่กุ้ง 8 ชิ้น',10,false,false,true,1),
  ('M02','แซลมอนโรล','Salmon Roll','maki',139,55,'assets/images/menu/salmon-roll.svg','แซลมอนสดม้วนข้าวญี่ปุ่น เสิร์ฟพร้อมวาซาบิ 8 ชิ้น',10,true,false,false,2),
  ('M03','สไปซี่ทูน่าโรล','Spicy Tuna Roll','maki',149,60,'assets/images/menu/spicy-tuna-roll.svg','ทูน่าสับคลุกซอสเผ็ดสไตล์เกาหลี เผ็ดกำลังดี 8 ชิ้น',10,true,true,true,3),
  ('M04','กุ้งเทมปุระโรล','Ebi Tempura Roll','maki',159,65,'assets/images/menu/ebi-tempura-roll.svg','กุ้งเทมปุระกรอบ ๆ ม้วนกับอะโวคาโด ราดซอสอูนางิ 8 ชิ้น',12,false,false,true,4),
  ('M05','อะโวคาโดมากิ','Avocado Maki','maki',89,30,'assets/images/menu/avocado-maki.svg','เมนูมังสวิรัติ อะโวคาโดสุกกำลังดี 6 ชิ้น',8,false,false,false,5),

  ('S01','ซาชิมิแซลมอน','Salmon Sashimi','sashimi',179,78,'assets/images/menu/salmon-sashimi.svg','แซลมอนสไลซ์หนา 5 ชิ้น บนน้ำแข็งเกล็ดหิมะ',6,true,false,true,1),
  ('S02','ซาชิมิทูน่า','Tuna Sashimi','sashimi',199,92,'assets/images/menu/tuna-sashimi.svg','ทูน่าอาคามิ 5 ชิ้น สดจากตลาดปลาทุกเช้า',6,true,false,false,2),
  ('S03','ซาชิมิรวม','Mixed Sashimi','sashimi',299,140,'assets/images/menu/mixed-sashimi.svg','แซลมอน ทูน่า ฮามาจิ อย่างละ 3 ชิ้น จัดเต็มจานใหญ่',10,true,false,true,3),

  ('D01','ข้าวหน้าแซลมอน','Salmon Don','don',189,72,'assets/images/menu/salmon-don.svg','แซลมอนสดเรียงเต็มชาม บนข้าวญี่ปุ่นหุงใหม่',10,true,false,true,1),
  ('D02','ข้าวหน้าปลาไหล','Unagi Don','don',259,110,'assets/images/menu/unagi-don.svg','ปลาไหลย่างเตาถ่าน ราดซอสสูตรเคี่ยว 3 ชั่วโมง',14,false,false,true,2),
  ('D03','ข้าวหน้าปลาดิบรวม','Chirashi Don','don',299,135,'assets/images/menu/chirashi-don.svg','ปลาดิบ 5 ชนิด พร้อมไข่ปลาแซลมอน โรยงาคั่ว',12,true,false,false,3),
  ('D04','ข้าวหน้ากุ้งเทมปุระ','Tendon','don',179,68,'assets/images/menu/tendon.svg','กุ้งเทมปุระ 3 ตัว ผักทอดกรอบ ราดซอสเทนดง',12,false,false,false,4),

  ('A01','เกี๊ยวซ่า','Gyoza','side',79,26,'assets/images/menu/gyoza.svg','เกี๊ยวหมูย่างกระทะ ก้นกรอบ 5 ชิ้น พร้อมน้ำจิ้มส้ม',10,false,false,true,1),
  ('A02','กุ้งเทมปุระ','Ebi Tempura','side',129,52,'assets/images/menu/ebi-tempura.svg','กุ้งตัวใหญ่ชุบแป้งทอดกรอบ 4 ตัว',12,false,false,false,2),
  ('A03','ทาโกยากิ','Takoyaki','side',89,30,'assets/images/menu/takoyaki.svg','แป้งนุ่มไส้ปลาหมึก 6 ลูก โรยปลาแห้งเต้นระบำ',10,false,false,true,3),
  ('A04','ถั่วแระญี่ปุ่น','Edamame','side',59,18,'assets/images/menu/edamame.svg','ถั่วแระต้มเกลือทะเล ทานเพลินระหว่างรออาหาร',5,false,false,false,4),
  ('A05','เต้าหู้ทอดน้ำซุป','Agedashi Tofu','side',79,24,'assets/images/menu/agedashi-tofu.svg','เต้าหู้ไข่ทอดกรอบนอกนุ่มใน ในน้ำซุปดาชิร้อน ๆ',10,false,false,false,5),
  ('A06','ไก่คาราอาเกะ','Karaage','side',99,36,'assets/images/menu/karaage.svg','ไก่หมักซีอิ๊วขิงกระเทียม ทอดกรอบ เสิร์ฟกับมายองเนส',12,false,false,true,6),

  ('R01','ราเมนโชยุ','Shoyu Ramen','noodle',149,55,'assets/images/menu/shoyu-ramen.svg','น้ำซุปซีอิ๊วใส กลมกล่อม พร้อมหมูชาชู ไข่ไหลและสาหร่าย',15,false,false,false,1),
  ('R02','ราเมนทงคตสึ','Tonkotsu Ramen','noodle',169,68,'assets/images/menu/tonkotsu-ramen.svg','ซุปกระดูกหมูเคี่ยว 12 ชั่วโมง ข้นนัว หอมกระเทียมเจียว',15,false,false,true,2),
  ('R03','อุด้งหม้อร้อน','Nabeyaki Udon','noodle',139,50,'assets/images/menu/nabeyaki-udon.svg','อุด้งเส้นหนานุ่มในหม้อดินร้อน ๆ พร้อมกุ้งเทมปุระ',15,false,false,false,3),

  ('W01','โมจิไอศกรีม','Mochi Ice Cream','dessert',69,20,'assets/images/menu/mochi-ice.svg','โมจิแป้งนุ่มไส้ไอศกรีม 3 ลูก 3 รสให้เลือก',3,false,false,true,1),
  ('W02','มัทฉะลาวา','Matcha Lava','dessert',89,32,'assets/images/menu/matcha-lava.svg','เค้กมัทฉะอุ่น ๆ ตัดแล้วไหลเยิ้ม เสิร์ฟกับไอศกรีมวานิลลา',10,false,false,true,2),
  ('W03','โดรายากิ','Dorayaki','dessert',59,18,'assets/images/menu/dorayaki.svg','แพนเค้กญี่ปุ่นไส้ถั่วแดงกวน 2 ชิ้น',6,false,false,false,3),

  ('B01','ชาเขียวร้อน','Green Tea','drink',39,8,'assets/images/menu/green-tea.svg','ชาเขียวเซนฉะแท้ ชงใหม่ทุกแก้ว เติมฟรี',3,false,false,false,1),
  ('B02','รามูเนะ','Ramune','drink',59,22,'assets/images/menu/ramune.svg','น้ำหวานอัดลมญี่ปุ่นขวดลูกแก้ว รสออริจินัล',2,false,false,true,2),
  ('B03','ยูซุโซดา','Yuzu Soda','drink',69,24,'assets/images/menu/yuzu-soda.svg','โซดาส้มยูซุ เปรี้ยวหอมสดชื่น ตัดเลี่ยนได้ดี',3,false,false,false,3),
  ('B04','โคล่า','Coke','drink',29,10,'assets/images/menu/cola.svg','น้ำอัดลมเย็น ๆ เสิร์ฟพร้อมน้ำแข็ง',1,false,false,false,4)
on conflict (code) do nothing;

/* โต๊ะ 14 โต๊ะ: A1-A6 (โซนหน้าร้าน) · B1-B5 (โซนซูชิบาร์) · C1-C3 (ห้องส่วนตัว) */
insert into public.dining_tables (table_no, seats, zone) values
  ('A1',2,'โซนหน้าร้าน'), ('A2',2,'โซนหน้าร้าน'), ('A3',4,'โซนหน้าร้าน'),
  ('A4',4,'โซนหน้าร้าน'), ('A5',4,'โซนหน้าร้าน'), ('A6',6,'โซนหน้าร้าน'),
  ('B1',1,'ซูชิบาร์'), ('B2',1,'ซูชิบาร์'), ('B3',1,'ซูชิบาร์'), ('B4',1,'ซูชิบาร์'), ('B5',1,'ซูชิบาร์'),
  ('C1',8,'ห้องส่วนตัว'), ('C2',8,'ห้องส่วนตัว'), ('C3',10,'ห้องส่วนตัว')
on conflict (table_no) do nothing;
