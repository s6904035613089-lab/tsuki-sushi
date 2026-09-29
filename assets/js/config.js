/* =============================================================
   config.js — ตั้งค่าหลักของระบบ Tsuki Sushi
   ============================================================= */

const TS_CONFIG = {
  brand: 'Tsuki Sushi',
  brandTh: 'ซูชิ สึกิ',
  tagline: 'ซูชิสดใหม่ ใต้แสงจันทร์',

  /* -----------------------------------------------------------
     Supabase — Dashboard → Project Settings → API
       SUPABASE_URL  = Project URL (https://xxxx.supabase.co)
       SUPABASE_KEY  = anon public key / publishable key
     คีย์นี้เปิดเผยได้ (ออกแบบมาให้ใช้ฝั่ง browser)
     ความปลอดภัยอยู่ที่ Row Level Security ใน supabase/schema.sql
     ----------------------------------------------------------- */
  SUPABASE_URL: 'https://djjifvixnxjnyhikjhhf.supabase.co',
  SUPABASE_KEY: 'sb_publishable_RRR9li4S8bhIw6J9ole0qQ_S_edyz6m',

  /* ค่าสำรองถ้าตาราง settings ยังไม่มีข้อมูล */
  serviceChargePct: 10,
  vatPct: 7,

  /* ช่องทางชำระเงินที่แคชเชียร์รองรับ */
  paymentMethods: [
    { id: 'cash',      name: 'เงินสด',     emoji: '💵' },
    { id: 'promptpay', name: 'พร้อมเพย์',  emoji: '📱' },
    { id: 'transfer',  name: 'โอนธนาคาร',  emoji: '🏦' },
    { id: 'card',      name: 'บัตร',       emoji: '💳' }
  ],

  /* สถานะออเดอร์ (ค่าใน DB → ป้ายไทย) */
  orderStatus: {
    pending:   { label: 'รอครัวรับ',  tag: 'tag-new' },
    cooking:   { label: 'กำลังทำ',    tag: 'tag-cooking' },
    served:    { label: 'เสิร์ฟแล้ว', tag: 'tag-done' },
    cancelled: { label: 'ยกเลิก',     tag: 'tag-out' }
  },
  itemStatus: {
    pending:   { label: 'รอทำ',      tag: 'tag-new' },
    cooking:   { label: 'กำลังทำ',   tag: 'tag-cooking' },
    done:      { label: 'เสร็จแล้ว', tag: 'tag-done' },
    cancelled: { label: 'ยกเลิก',    tag: 'tag-out' }
  },
  sessionStatus: {
    open:      { label: 'กำลังทาน',   tag: 'tag-new' },
    billing:   { label: 'รอเก็บเงิน', tag: 'tag-cooking' },
    paid:      { label: 'ชำระแล้ว',   tag: 'tag-done' },
    cancelled: { label: 'ยกเลิก',     tag: 'tag-out' }
  },

  /* ครัว: ถ้าออเดอร์ค้างเกินกี่นาทีให้กะพริบเตือน */
  lateAfterMinutes: 12,

  money: (n) => '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
};

window.TS_CONFIG = TS_CONFIG;
