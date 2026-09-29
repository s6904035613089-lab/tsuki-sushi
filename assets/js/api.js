/* =============================================================
   api.js — ชั้นเชื่อมข้อมูล → Supabase
   ทุกหน้าเรียก `await API.init()` ก่อนใช้งาน

   ลูกค้า (ไม่ล็อกอิน) ใช้ได้เฉพาะ RPC ที่ต้องมี token ของโต๊ะ
   พนักงานล็อกอินด้วย Supabase Auth แล้วเข้าถึงตารางตาม RLS
   ============================================================= */

const must = ({ data, error }) => {
  if (error) throw new Error(error.message || String(error));
  return data;
};

const API = {
  sb: null,
  _user: null,
  _staff: null,
  _settings: {},
  _ready: null,

  isConfigured() {
    return !!(TS_CONFIG.SUPABASE_URL && TS_CONFIG.SUPABASE_KEY && window.supabase);
  },

  init() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      if (!this.isConfigured()) { this._setupBanner(); return this; }
      this.sb = window.supabase.createClient(TS_CONFIG.SUPABASE_URL, TS_CONFIG.SUPABASE_KEY);
      const { data } = await this.sb.auth.getSession();
      this._user = data?.session?.user || null;
      await Promise.all([this._loadStaff(), this.loadSettings()]);
      this.sb.auth.onAuthStateChange((_e, session) => {
        this._user = session?.user || null;
        if (!this._user) this._staff = null;
      });
      return this;
    })();
    return this._ready;
  },

  _setupBanner() {
    const show = () => document.body.insertAdjacentHTML('afterbegin', `
      <div style="position:fixed;top:0;left:0;right:0;z-index:3000;background:#151a33;color:#fff;padding:10px 16px;font-size:.86rem;text-align:center">
        ⚠️ ยังไม่ได้ตั้งค่า Supabase — ใส่ <code>SUPABASE_URL</code> / <code>SUPABASE_KEY</code> ใน
        <code>assets/js/config.js</code> แล้วรัน <code>supabase/schema.sql</code> (ดู <code>supabase/README.md</code>)
      </div>`);
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  },

  async _loadStaff() {
    if (!this._user) { this._staff = null; return; }
    const { data } = await this.sb.from('staff').select('*').eq('id', this._user.id).maybeSingle();
    this._staff = data || null;
  },

  async loadSettings() {
    const { data } = await this.sb.from('settings').select('key,value');
    const s = {};
    (data || []).forEach(r => { s[r.key] = r.value; });
    this._settings = s;
    return s;
  },
  setting(key, fallback) {
    const v = this._settings[key];
    return v === undefined || v === null ? fallback : v;
  },
  servicePct() { return Number(this.setting('service_charge_pct', TS_CONFIG.serviceChargePct)); },
  vatPct()     { return Number(this.setting('vat_pct', TS_CONFIG.vatPct)); },
  async saveSettings(obj) {
    const rows = Object.entries(obj).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
    must(await this.sb.from('settings').upsert(rows));
    await this.loadSettings();
  },

  /* ---------------------------------------------------- เมนู (อ่านได้ทุกคน) */
  async getCategories() {
    return must(await this.sb.from('categories').select('*').eq('active', true).order('sort_order'));
  },
  async getMenu({ onlyAvailable = true } = {}) {
    let q = this.sb.from('menu_items').select('*').order('sort_order');
    if (onlyAvailable) q = q.eq('available', true);
    return must(await q);
  },
  async saveMenuItem(m) {
    const row = {
      code: String(m.code || '').trim().toUpperCase(),
      name: String(m.name || '').trim(),
      name_en: String(m.name_en || '').trim(),
      category_id: m.category_id || null,
      price: Number(m.price) || 0,
      cost: Number(m.cost) || 0,
      image_url: m.image_url || '',
      description: m.description || '',
      prep_minutes: Number(m.prep_minutes) || 10,
      is_raw: !!m.is_raw, is_spicy: !!m.is_spicy, is_popular: !!m.is_popular,
      available: m.available !== false,
      sort_order: Number(m.sort_order) || 0
    };
    if (m.id) return must(await this.sb.from('menu_items').update(row).eq('id', m.id).select().single());
    return must(await this.sb.from('menu_items').insert(row).select().single());
  },
  async deleteMenuItem(id) { must(await this.sb.from('menu_items').delete().eq('id', id)); },
  async setAvailable(id, available) {
    return must(await this.sb.from('menu_items').update({ available }).eq('id', id).select().single());
  },
  async uploadMenuImage(blob, filename) {
    const ext = (filename.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '.' + ext;
    must(await this.sb.storage.from('menu-images').upload(path, blob, { contentType: blob.type || 'image/jpeg' }));
    return this.sb.storage.from('menu-images').getPublicUrl(path).data.publicUrl;
  },

  /* ---------------------------------------------------- โต๊ะ / session (พนักงาน) */
  async getTables() {
    return must(await this.sb.from('dining_tables').select('*').eq('active', true).order('table_no'));
  },
  async getOpenSessions() {
    return must(await this.sb.from('table_sessions')
      .select('*, dining_tables(table_no, zone, seats)')
      .in('status', ['open', 'billing']).order('opened_at'));
  },
  async openTable(tableNo, guests) {
    return must(await this.sb.rpc('open_table', { p_table_no: tableNo, p_guests: Number(guests) }));
  },
  async cancelSession(id, reason = '') {
    return must(await this.sb.rpc('cancel_session', { p_session_id: id, p_reason: reason }));
  },
  async getBill(sessionId) {
    return must(await this.sb.rpc('get_bill', { p_session_id: sessionId }));
  },
  async checkout(sessionId, payments, discount = 0) {
    return must(await this.sb.rpc('checkout_session', {
      p_session_id: sessionId, p_payments: payments, p_discount: Number(discount) || 0
    }));
  },
  async getSessions({ from = null, status = null, limit = 100 } = {}) {
    let q = this.sb.from('table_sessions').select('*, dining_tables(table_no, zone)')
      .order('opened_at', { ascending: false }).limit(limit);
    if (from) q = q.gte('opened_at', from);
    if (status) q = q.eq('status', status);
    return must(await q);
  },

  /* ---------------------------------------------------- ครัว (พนักงาน) */
  async getKitchenOrders() {
    return must(await this.sb.from('orders')
      .select('*, table_sessions(session_no, guests, dining_tables(table_no, zone)), order_items(*)')
      .in('status', ['pending', 'cooking'])
      .order('created_at'));
  },
  async getServedToday() {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    return must(await this.sb.from('orders').select('id', { count: 'exact', head: false })
      .eq('status', 'served').gte('created_at', from.toISOString()));
  },
  async setOrderStatus(orderId, status) {
    return must(await this.sb.rpc('set_order_status', { p_order_id: orderId, p_status: status }));
  },
  async setItemStatus(itemId, status) {
    return must(await this.sb.rpc('set_item_status', { p_item_id: itemId, p_status: status }));
  },
  /** ฟังการเปลี่ยนแปลงแบบเรียลไทม์ (ครัว / แคชเชียร์) */
  watch(tables, onChange) {
    const ch = this.sb.channel('ts-' + Math.random().toString(36).slice(2));
    tables.forEach(t => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, onChange));
    ch.subscribe();
    return () => this.sb.removeChannel(ch);
  },

  /* ---------------------------------------------------- ลูกค้า (ใช้ token จาก QR) */
  async sessionByToken(token) {
    return must(await this.sb.rpc('session_by_token', { p_token: token }));
  },
  async placeOrder(token, items, note = '') {
    return must(await this.sb.rpc('place_order', { p_token: token, p_items: items, p_note: note }));
  },
  async requestBill(token) {
    return must(await this.sb.rpc('request_bill', { p_token: token }));
  },

  /* ---------------------------------------------------- แจ้งเตือน Telegram */
  async getNotifySettings() {
    return must(await this.sb.from('notify_settings').select('*').eq('id', 1).maybeSingle())
      || { id: 1, enabled: false, telegram_bot_token: '', telegram_chat_id: '',
           notify_order: true, notify_bill: true, notify_payment: true, notify_table: false };
  },
  async saveNotifySettings(s) {
    return must(await this.sb.from('notify_settings').upsert({
      id: 1, enabled: !!s.enabled,
      telegram_bot_token: String(s.telegram_bot_token || '').trim(),
      telegram_chat_id: String(s.telegram_chat_id || '').trim(),
      notify_order: !!s.notify_order, notify_bill: !!s.notify_bill,
      notify_payment: !!s.notify_payment, notify_table: !!s.notify_table,
      updated_at: new Date().toISOString()
    }).select().single());
  },
  async telegramTest() {
    const reqId = must(await this.sb.rpc('telegram_test'));
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const r = must(await this.sb.rpc('telegram_check', { p_request_id: reqId }));
      if (r.done) return r;
    }
    return { done: false };
  },
  async telegramFindChats(token) {
    const res = await fetch('https://api.telegram.org/bot' + encodeURIComponent(token.trim()) + '/getUpdates');
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || 'Token ไม่ถูกต้อง');
    const seen = {};
    json.result.forEach(u => {
      const c = u.message?.chat || u.edited_message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
      if (c) seen[c.id] = { id: c.id, type: c.type,
        title: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id) };
    });
    return Object.values(seen);
  },
  async getNotificationLog(limit = 20) {
    return must(await this.sb.from('notification_log').select('*').order('created_at', { ascending: false }).limit(limit));
  },

  /* ---------------------------------------------------- รายงาน */
  async getDailySales(days = 14) {
    const from = new Date(); from.setDate(from.getDate() - days);
    return must(await this.sb.from('v_daily_sales').select('*')
      .gte('day', from.toISOString().slice(0, 10)).order('day'));
  },
  async getTopItems(limit = 8) {
    return must(await this.sb.from('v_item_sales').select('*').order('qty_sold', { ascending: false }).limit(limit));
  },

  /* ---------------------------------------------------- พนักงาน / login */
  async getStaff() { return must(await this.sb.from('staff').select('*').order('created_at')); },
  async updateStaff(id, patch) {
    return must(await this.sb.from('staff').update(patch).eq('id', id).select().single());
  },
  async login(email, password) {
    if (!this.sb) throw new Error('ยังไม่ได้ตั้งค่า Supabase (ดู supabase/README.md)');
    const data = must(await this.sb.auth.signInWithPassword({ email: String(email).trim(), password }));
    this._user = data.user;
    await this._loadStaff();
    if (!this._staff || !this._staff.active) {
      await this.sb.auth.signOut(); this._user = null; this._staff = null;
      throw new Error('บัญชีนี้ยังไม่ได้รับสิทธิ์พนักงาน หรือถูกปิดใช้งาน');
    }
    return this.session();
  },
  async logout() { if (this.sb) await this.sb.auth.signOut(); this._user = null; this._staff = null; },

  session() {
    if (!this._user || !this._staff) return null;
    return { id: this._user.id, email: this._user.email,
             name: this._staff.full_name || this._user.email, role: this._staff.role };
  },
  isAdmin() { return this.session()?.role === 'admin'; },
  /** roles = รายชื่อบทบาทที่เข้าได้ (admin เข้าได้เสมอ) */
  require(next, roles = null) {
    const s = this.session();
    if (!s) { location.href = 'login.html?next=' + next; return null; }
    if (roles && s.role !== 'admin' && !roles.includes(s.role)) {
      alert('บัญชีนี้ (' + s.role + ') ไม่มีสิทธิ์เข้าหน้านี้');
      location.href = 'index.html'; return null;
    }
    return s;
  }
};

window.API = API;
