# ตั้งค่า Supabase สำหรับ Tsuki Sushi 🌙

## 1) สร้างโปรเจกต์ + รันสคีมา (ทำครั้งเดียว)

1. เปิด https://supabase.com/dashboard → **New project**
   - Name: `tsuki-sushi` · Region: **Southeast Asia (Singapore)** · ตั้ง Database password แล้วเก็บไว้
2. รอโปรเจกต์พร้อม (~2 นาที) → เมนูซ้าย **SQL Editor** → **New query**
3. คัดลอกเนื้อหาทั้งไฟล์ [`schema.sql`](schema.sql) วาง แล้วกด **Run**
   - ถ้าขึ้นกล่อง "Potential issue detected" ให้กด **Run query** (มาจาก `drop … if exists` ซึ่งปลอดภัย)
   - สำเร็จเมื่อขึ้น **Success. No rows returned**
   - รันซ้ำได้ ไม่พัง (ใช้ `if not exists` / `or replace` ทุกจุด)

## 2) เอาคีย์มาใส่ในเว็บ

Dashboard → **Project Settings → API keys**

| ค่าใน Dashboard | ใส่ที่ `assets/js/config.js` |
|---|---|
| Project URL | `SUPABASE_URL` |
| anon / publishable key | `SUPABASE_KEY` |

> คีย์นี้เปิดเผยได้ (ออกแบบให้ใช้ใน browser) ความปลอดภัยอยู่ที่ Row Level Security
> **ห้าม** นำ `service_role` / secret key มาใส่ในเว็บเด็ดขาด

## 3) สร้างบัญชีพนักงาน

**Authentication → Users → Add user → Create new user** (ติ๊ก *Auto Confirm User*)

- บัญชี**แรก** = `admin` อัตโนมัติ · บัญชีถัดไป = `waiter`
- เปลี่ยนสิทธิ์ได้ที่ หลังบ้าน → พนักงาน
- ปิดการสมัครเอง: **Authentication → Providers → Email → ปิด "Allow new users to sign up"**

| สิทธิ์ | เข้าได้ |
|---|---|
| `admin` | ทุกหน้า + หลังบ้าน |
| `waiter` | เปิดโต๊ะ/QR + หน้าครัว |
| `kitchen` | หน้าครัว |
| `cashier` | เปิดโต๊ะ/QR + แคชเชียร์ |

## 4) แจ้งเตือน Telegram (ไม่บังคับ)

ติดตั้งมาพร้อม `schema.sql` แล้ว — ตั้งค่าที่ **หลังบ้าน → ตั้งค่า → 🔔 แจ้งเตือนผ่าน Telegram**
(สร้างบอทกับ @BotFather → วาง token → กดค้นหา Chat ID → เปิดใช้งาน → ส่งทดสอบ)

---

## โครงสร้างตาราง

```
staff            พนักงาน (ผูก auth.users)  role: admin | cashier | kitchen | waiter
categories       หมวดเมนู 8 หมวด
menu_items       เมนู 36 รายการ  code, ราคา, ต้นทุน, รูป, ของดิบ/เผ็ด/ยอดนิยม, available
dining_tables    โต๊ะ 14 โต๊ะ  table_no, seats, zone
table_sessions   รอบการนั่งโต๊ะ = 1 QR  token, guests, status, ยอดรวมทั้งหมด
orders           ออเดอร์แต่ละรอบที่กดสั่ง  round_no, status
order_items      รายการอาหาร (snapshot ชื่อ/ราคา)  status รายจาน
payments         การรับชำระ (หลายช่องทางต่อบิลได้)
settings         ค่าตั้งค่าร้าน (Service Charge, VAT, ข้อมูลใบเสร็จ)
notify_settings  Telegram token / เปิด-ปิดแต่ละเหตุการณ์
notification_log ประวัติข้อความที่ส่ง
```

### Function หลัก

| function | ใคร | ทำอะไร |
|---|---|---|
| `open_table(table_no, guests)` | พนักงาน | เปิดโต๊ะ → คืน session + **token** สำหรับทำ QR (โต๊ะเดียวเปิดซ้อนไม่ได้) |
| `session_by_token(token)` | **ลูกค้า** | ข้อมูลโต๊ะ + ออเดอร์ + ยอดรวม (หน้าเมนู) |
| `place_order(token, items, note)` | **ลูกค้า** | สั่งอาหาร → สร้าง order + items → แจ้ง Telegram |
| `request_bill(token)` | **ลูกค้า** | กดเรียกเก็บเงิน → status = billing → แจ้ง Telegram |
| `set_order_status` / `set_item_status` | ครัว | เปลี่ยนสถานะทั้งออเดอร์ / รายจาน |
| `get_bill(session_id)` | แคชเชียร์ | บิลเต็มพร้อมรายการและการชำระ |
| `checkout_session(session_id, payments, discount)` | แคชเชียร์ | คิดยอด → บันทึกชำระ → ปิดโต๊ะ → แจ้ง Telegram |
| `cancel_session(session_id, reason)` | พนักงาน | ยกเลิกโต๊ะโดยไม่คิดเงิน |

### การคิดเงิน

```
subtotal       = ผลรวมรายการที่ไม่ถูกยกเลิก
service_charge = subtotal × service_charge_pct%      (ค่าเริ่มต้น 10%)
vat            = (subtotal + service) × vat_pct%     (ค่าเริ่มต้น 7%)
total          = subtotal + service + vat − discount
```
คำนวณในฐานข้อมูลทั้งหมด (`recalc_session`) — หน้าเว็บส่งแค่ `menu_item_id` + จำนวน

### สิทธิ์ (RLS)

| ตาราง | ลูกค้า (anon) | พนักงาน | แอดมิน |
|---|---|---|---|
| categories, menu_items, settings | อ่าน | อ่าน/เขียน (settings อ่าน) | ทั้งหมด |
| table_sessions, orders, order_items, payments, dining_tables | ❌ เข้าถึงผ่าน RPC ที่ต้องมี token เท่านั้น | ทั้งหมด | ทั้งหมด |
| staff | ❌ | อ่าน | ทั้งหมด |
| notify_settings (เก็บ token) | ❌ | ❌ | ทั้งหมด |

**ทำไมลูกค้าไม่ต้องล็อกอินแต่ยังปลอดภัย:** ทุกคำสั่งของลูกค้าผ่าน function `security definer`
ที่ต้องส่ง `token` ของโต๊ะ (สุ่ม 16 ตัวอักษร) ซึ่งรู้ได้จากการสแกน QR ที่โต๊ะเท่านั้น
และ token ใช้ได้เฉพาะตอน session ยัง `open` — ปิดบิลแล้วสั่งต่อไม่ได้

### Realtime

`orders`, `order_items`, `table_sessions` เปิด realtime ไว้ — หน้าครัวและแคชเชียร์อัปเดตเองทันทีที่ลูกค้าสั่ง
