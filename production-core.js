(() => {
  'use strict';

  const cfg = window.APP_CONFIG;
  if (!cfg) throw new Error('APP_CONFIG no está cargado');

  const SESSION_KEY = `${cfg.appName}.operatorSession.v1`;
  const DB_NAME = `${cfg.appName}.offline.v1`;
  const DB_VERSION = 1;
  const QUEUE_STORE = 'syncQueue';
  const CACHE_STORE = 'cache';

  const normalizeHost = value => String(value ?? '').trim().replace(/\s+/g, '').toUpperCase();
  const normalizeUA = value => String(value ?? '').replace(/\D/g, '');
  const isValidHost = value => /^M[A-Z0-9]{11}$/.test(normalizeHost(value));
  const isValidUA = value => /^0000\d{12}$/.test(normalizeUA(value));

  class StorageCache {
    constructor() { this.dbPromise = null; }
    open() {
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB no disponible'));
      });
      return this.dbPromise;
    }
    async put(store, value) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error('No se pudo guardar localmente'));
      });
    }
    async getAll(store) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error || new Error('No se pudo leer el almacenamiento local'));
      });
    }
    async delete(store, key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('No se pudo limpiar la cola local'));
      });
    }
    async setCache(key, value) { return this.put(CACHE_STORE, { key, value, at: Date.now() }); }
    async getCache(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const req = db.transaction(CACHE_STORE, 'readonly').objectStore(CACHE_STORE).get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error || new Error('No se pudo leer caché'));
      });
    }
  }

  class AuthService {
    constructor() { this.session = this.readSession(); }
    readSession() {
      try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
    }
    saveSession(session) {
      this.session = session;
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(SESSION_KEY);
      document.dispatchEvent(new CustomEvent('production:session-changed', { detail: session }));
    }
    get token() { return this.session?.token || ''; }
    get operator() { return this.session?.operator || null; }
    get isAdmin() { return this.operator?.role === 'admin'; }
    async edge(action, body = {}, token = this.token) {
      const response = await fetch(cfg.operatorApiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'apikey': cfg.supabasePublishableKey,
          ...(token ? { 'x-operator-session': token } : {})
        },
        body: JSON.stringify({ action, ...body })
      });
      const data = await response.json().catch(() => ({ ok: false, code: 'INVALID_RESPONSE' }));
      if (!response.ok && !data?.code) data.code = `HTTP_${response.status}`;
      return data;
    }
    listOperators() { return this.edge('list'); }
    bootstrap(name, pin) { return this.edge('bootstrap', { name, pin }, ''); }
    async login(operatorId, pin) {
      const data = await this.edge('login', {
        operator_id: operatorId,
        pin,
        app_name: cfg.appName,
        device_info: deviceInfo()
      }, '');
      if (data?.ok) {
        this.saveSession({ token: data.token, operator: data.operator, session_id: data.session_id, expires_at: data.expires_at });
        document.dispatchEvent(new CustomEvent('operator:login', { detail: data.operator }));
      }
      return data;
    }
    async validate() {
      if (!this.token) return { ok: false, code: 'NO_SESSION' };
      const data = await this.edge('validate');
      if (!data?.ok) this.saveSession(null);
      else this.saveSession({ ...this.session, operator: data.operator, session_id: data.session_id, expires_at: data.expires_at });
      return data;
    }
    async logout() {
      try { if (this.token) await this.edge('logout'); } finally {
        const previous = this.operator;
        this.saveSession(null);
        document.dispatchEvent(new CustomEvent('operator:logout', { detail: previous }));
      }
    }
    createOperator(name, pin, role = 'operator') { return this.edge('create_operator', { name, pin, role }); }
    updateOperator(operator_id, patch) { return this.edge('update_operator', { operator_id, ...patch }); }
    changePin(current_pin, new_pin) { return this.edge('change_pin', { current_pin, new_pin }); }
    adminList() { return this.edge('admin_list'); }
  }

  class DataService {
    constructor(auth, cache) { this.auth = auth; this.cache = cache; this.client = null; }
    getClient() {
      const token = this.auth.token;
      if (!window.supabase?.createClient) throw new Error('Supabase JS no está disponible');
      if (!this.client || this.client.__operatorToken !== token) {
        const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          global: { headers: token ? { 'x-operator-session': token } : {} }
        });
        client.__operatorToken = token;
        this.client = client;
      }
      return this.client;
    }
    async insert(table, payload) {
      const { data, error } = await this.getClient().from(table).insert(payload).select().single();
      if (error) throw error;
      return data;
    }
    async select(table, queryBuilder) {
      let query = this.getClient().from(table).select('*');
      if (typeof queryBuilder === 'function') query = queryBuilder(query);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }
    async registerEquipment(payload) {
      const response = await fetch(cfg.matchApiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'apikey': cfg.supabasePublishableKey, 'x-operator-session': this.auth.token },
        body: JSON.stringify({ action: 'register', ...payload })
      });
      const data = await response.json().catch(() => ({ ok: false, code: 'INVALID_RESPONSE' }));
      if (!response.ok && !['DUPLICATE'].includes(data?.code || '')) throw Object.assign(new Error(data?.message || 'No se pudo registrar'), { code: data?.code });
      return data;
    }
    async latestVersion() {
      const { data, error } = await this.getClient().from('app_versions').select('version,minimum_supported_version,critical_update,updated_at').eq('app_name', cfg.appName).maybeSingle();
      if (error) throw error;
      return data;
    }
  }

  class AuditService {
    constructor(auth, sync) { this.auth = auth; this.sync = sync; }
    record(action, fields = {}) {
      if (!this.auth.operator) return Promise.resolve(false);
      return this.sync.enqueue('audit', {
        operator_id: this.auth.operator.id,
        action,
        app_name: cfg.appName,
        app_version: cfg.appVersion,
        session_id: this.auth.session?.session_id || null,
        device_info: deviceInfo(),
        ...fields
      });
    }
  }

  class SyncService {
    constructor(auth, data, cache) {
      this.auth = auth; this.data = data; this.cache = cache; this.running = false; this.state = 'offline'; this.pending = 0;
    }
    async init() {
      window.addEventListener('online', () => this.flush());
      window.addEventListener('offline', () => this.updateState('offline'));
      await this.refreshPending();
      if (navigator.onLine) this.flush(); else this.updateState('offline');
    }
    async refreshPending() { this.pending = (await this.cache.getAll(QUEUE_STORE)).length; renderSyncBadge(this.state, this.pending); }
    updateState(state) { this.state = state; renderSyncBadge(state, this.pending); }
    async enqueue(type, payload) {
      const task = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, type, payload, createdAt: new Date().toISOString(), attempts: 0 };
      await this.cache.put(QUEUE_STORE, task);
      await this.refreshPending();
      if (navigator.onLine) this.flush();
      return task.id;
    }
    async execute(task) {
      if (!this.auth.token) throw new Error('No hay sesión activa');
      if (task.type === 'audit') return this.data.insert('audit_events', task.payload);
      if (task.type === 'error') return this.data.insert('error_events', task.payload);
      if (task.type === 'pdt.label') return this.data.insert('pdt_label_history', task.payload);
      if (task.type === 'pdt.text') return this.data.insert('pdt_text_history', task.payload);
      if (task.type === 'equipment.register') return this.data.registerEquipment(task.payload);
      throw new Error(`Tipo de sincronización desconocido: ${task.type}`);
    }
    async flush() {
      if (this.running || !navigator.onLine || !this.auth.token) return;
      this.running = true; this.updateState('syncing');
      try {
        const tasks = (await this.cache.getAll(QUEUE_STORE)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        for (const task of tasks) {
          try {
            await this.execute(task);
            await this.cache.delete(QUEUE_STORE, task.id);
          } catch (error) {
            task.attempts = (task.attempts || 0) + 1;
            task.lastError = String(error?.message || error);
            await this.cache.put(QUEUE_STORE, task);
            if (!navigator.onLine) break;
            if (task.attempts >= 5) this.updateState('error');
          }
        }
        await this.refreshPending();
        if (this.state !== 'error') this.updateState(this.pending ? 'pending' : 'synced');
      } finally { this.running = false; }
    }
  }

  class ErrorService {
    constructor(auth, sync) { this.auth = auth; this.sync = sync; }
    install() {
      window.addEventListener('error', event => this.capture('window', event.error || event.message));
      window.addEventListener('unhandledrejection', event => this.capture('promise', event.reason));
    }
    capture(module, error) {
      const payload = {
        operator_id: this.auth.operator?.id || null,
        app_name: cfg.appName,
        app_version: cfg.appVersion,
        module,
        message: String(error?.message || error || 'Error desconocido').slice(0, 1000),
        stack: String(error?.stack || '').slice(0, 6000) || null,
        online: navigator.onLine,
        browser: navigator.userAgent.slice(0, 500),
        payload: {}
      };
      if (this.auth.token) this.sync.enqueue('error', payload).catch(() => {});
    }
  }

  const ValidationService = Object.freeze({ normalizeHost, normalizeUA, isValidHost, isValidUA });
  const cache = new StorageCache();
  const auth = new AuthService();
  const data = new DataService(auth, cache);
  const sync = new SyncService(auth, data, cache);
  const audit = new AuditService(auth, sync);
  const errors = new ErrorService(auth, sync);

  function deviceInfo() {
    return {
      ua: navigator.userAgent.slice(0, 300),
      platform: navigator.platform || '',
      language: navigator.language || '',
      screen: `${screen.width}x${screen.height}`,
      online: navigator.onLine
    };
  }

  function ensureStatusUI() {
    if (document.getElementById('productionStatus')) return;
    const el = document.createElement('div');
    el.id = 'productionStatus';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:3000;display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:999px;background:rgba(15,23,42,.92);color:#e2e8f0;font:600 11px/1.2 system-ui;border:1px solid rgba(148,163,184,.28);box-shadow:0 8px 28px rgba(0,0,0,.22);max-width:calc(100vw - 20px)';
    el.innerHTML = '<span id="productionStatusDot">●</span><span id="productionStatusText">Iniciando…</span>';
    document.body.appendChild(el);
  }

  function renderSyncBadge(state, pending) {
    ensureStatusUI();
    const text = document.getElementById('productionStatusText');
    const dot = document.getElementById('productionStatusDot');
    if (!text || !dot) return;
    const map = {
      synced: `Sincronizado${pending ? ` · ${pending} pendientes` : ''}`,
      syncing: `Sincronizando…${pending ? ` · ${pending}` : ''}`,
      offline: `Sin conexión${pending ? ` — ${pending} cambios pendientes` : ''}`,
      pending: `${pending} cambios pendientes`,
      error: `Error de sincronización${pending ? ` · ${pending} pendientes` : ''}`
    };
    text.textContent = map[state] || map.offline;
    dot.style.color = state === 'synced' ? '#22c55e' : state === 'syncing' ? '#60a5fa' : state === 'error' ? '#f87171' : '#f59e0b';
  }

  function showUpdate(version) {
    if (document.getElementById('appUpdateNotice')) return;
    const box = document.createElement('div');
    box.id = 'appUpdateNotice';
    box.style.cssText = 'position:fixed;left:50%;bottom:54px;transform:translateX(-50%);z-index:3100;padding:10px 12px;border-radius:12px;background:#0f172a;color:#fff;font:600 12px system-ui;box-shadow:0 10px 34px rgba(0,0,0,.28);display:flex;gap:10px;align-items:center';
    box.innerHTML = `<span>Hay una nueva versión disponible (${escapeHtml(version)}).</span><button type="button" style="padding:6px 9px;border:0;border-radius:8px;font-weight:700;cursor:pointer">Actualizar aplicación</button>`;
    box.querySelector('button').addEventListener('click', () => location.reload());
    document.body.appendChild(box);
  }

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch])); }

  async function checkVersion() {
    try {
      const latest = await data.latestVersion();
      if (latest?.version && latest.version !== cfg.appVersion) showUpdate(latest.version);
    } catch (error) { errors.capture('version-check', error); }
  }

  async function init() {
    ensureStatusUI();
    errors.install();
    await sync.init();
    if (auth.token) {
      const result = await auth.validate().catch(() => ({ ok: false }));
      if (result?.ok) {
        document.dispatchEvent(new CustomEvent('operator:login', { detail: result.operator }));
        sync.flush();
      }
    }
    checkVersion();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`service-worker.js?v=${encodeURIComponent(cfg.appVersion)}`).catch(error => errors.capture('service-worker', error));
    document.dispatchEvent(new CustomEvent('production:ready'));
  }

  window.ProductionCore = {
    config: cfg,
    StorageCache: cache,
    ValidationService,
    AuthService: auth,
    DataService: data,
    SyncService: sync,
    AuditService: audit,
    ErrorService: errors,
    init
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
