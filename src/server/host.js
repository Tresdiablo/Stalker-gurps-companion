'use strict';
/**
 * The campaign host: serves the UI over HTTP and runs the authoritative engine behind a
 * WebSocket. The desktop app runs this in-process (GM window on 127.0.0.1). With LAN hosting
 * enabled (Settings), other computers — including over Radmin VPN — connect with a browser or
 * the desktop app as players. Every client action is validated by the engine.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const { CampaignStore } = require('./storage');
const { GcsService } = require('./gcs-service');
const { TtsBridge } = require('./tts-bridge');
const { viewFor } = require('../core/views');
const { migrateLegacy } = require('../core/legacy');
const { ActionError } = require('../core/errors');
const { Context } = require('../core/context');
const inv = require('../core/inventory');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json', '.lua': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const ROOT = path.join(__dirname, '..', '..');

function hashCode(code, salt = crypto.randomBytes(16).toString('hex')) { return `${salt}:${crypto.scryptSync(String(code), salt, 32).toString('hex')}`; }
function checkCode(code, stored) { if (!stored) return false; const [salt, h] = stored.split(':'); const a = Buffer.from(crypto.scryptSync(String(code), salt, 32).toString('hex')); const b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function token() { return crypto.randomBytes(24).toString('base64url'); }
function imageKind(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}
function pngSize(buf) { return imageKind(buf) === 'png' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null; }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new Error('Upload too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

class Host {
  constructor({ dataDir, port = 7788, bind = '127.0.0.1', resourcesPath = '', appPath = ROOT, legacyDataFile = null, log = console, portFallback = false } = {}) {
    this.dataDir = dataDir;
    this.portFallback = portFallback;
    this.port = port;
    this.bind = bind;
    this.log = log;
    this.legacyDataFile = legacyDataFile;
    this.store = new CampaignStore(dataDir);
    this.sessions = new Map(); // token -> { role, playerId }
    this.oneTime = new Map(); // token -> session (for local windows)
    this.gmToken = token();
    this.sessions.set(this.gmToken, { role: 'gm' });
    this.clients = new Set();
    this.current = null;
    this.broadcastTimer = null;
    this.ttsSelection = null;
    this.systemNotes = [];
    this.gcs = new GcsService({ configFile: path.join(dataDir, 'gcs-config.json'), resourcesPath, appPath, onChange: (charId, text, file) => this.gcsChanged(charId, text, file), onError: (e, charId) => this.notify('gcs', `GCS sync problem${charId ? ` for ${this.current?.state.characters[charId]?.name || charId}` : ''}: ${e.message}`) });
    this.tts = new TtsBridge({ onMessage: m => this.ttsMessage(m), onStatus: () => this.broadcastSystem() });
  }

  /* ------------------------------------------------------------- lifecycle */
  async start() {
    const list = this.store.list();
    if (!list.length) {
      this.store.create({ name: 'S.T.A.L.K.E.R. Campaign' });
      this.store.create({ name: 'Test Campaign (safe to experiment)', test: true });
    }
    const idx = this.store.index();
    const first = idx.last && this.store.list().some(c => c.id === idx.last) ? idx.last : this.store.list().find(c => !c.test)?.id || this.store.list()[0].id;
    this.openCampaign(first);
    this.server = http.createServer((req, res) => this.http(req, res).catch(e => { if (!res.headersSent) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(e.message); } }));
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
    this.server.on('upgrade', (req, sock, head) => {
      if (!req.url.startsWith('/ws')) return sock.destroy();
      const session = this.sessionFromReq(req);
      if (!session) { sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return sock.destroy(); }
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) { sock.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return sock.destroy(); }
      this.wss.handleUpgrade(req, sock, head, ws => this.connection(ws, session));
    });
    await this.listen(this.current?.state.settings.hostLan ? '0.0.0.0' : this.bind);
    return this;
  }

  listen(bind) {
    return new Promise((resolve, reject) => {
      const onErr = e => {
        this.server.off('listening', onOk);
        if (e.code === 'EADDRINUSE' && this.portFallback && this.port !== 0) { this.log.error?.(`Port ${this.port} is busy; using a free port.`); this.port = 0; this.listen(bind).then(resolve, reject); return; }
        reject(e);
      };
      const onOk = () => { this.server.off('error', onErr); this.bindAddress = bind; this.port = this.server.address().port; resolve(); };
      this.server.once('error', onErr);
      this.server.once('listening', onOk);
      this.server.listen(this.port, bind);
    });
  }

  async setLan(enabled) {
    const want = enabled ? '0.0.0.0' : '127.0.0.1';
    if (this.bindAddress === want) return;
    await new Promise(r => this.server.close(() => r()));
    for (const c of this.clients) c.ws.terminate();
    await this.listen(want);
  }

  async stop() {
    this.gcs.close();
    this.tts.stop();
    if (this.current) this.current.close();
    for (const c of this.clients) c.ws.terminate();
    await new Promise(r => this.server ? this.server.close(() => r()) : r());
  }

  url(tok = this.gmToken) { return `http://127.0.0.1:${this.port}/?gm=${tok}`; }

  /** One-time login link for a local player window. */
  playerLink(playerId) {
    const t = token();
    this.oneTime.set(t, { role: 'player', playerId });
    return `http://127.0.0.1:${this.port}/?pt=${t}`;
  }

  openCampaign(id) {
    if (this.current) { this.current.close(); this.gcs.close(); }
    this.current = this.store.open(id, { changed: info => this.changed(info) });
    for (const [t, s] of [...this.sessions]) if (s.role === 'player') this.sessions.delete(t); // players re-login per campaign
    this.gcs.syncLinks(this.current.state);
    const r = this.current.recovery;
    if (r.crashed || r.replayed || r.usedBackup) this.notify('recovery', `Recovered after an abnormal shutdown: ${r.replayed} unsaved action(s) restored from the journal${r.skipped ? `, ${r.skipped} unreadable entr${r.skipped === 1 ? 'y' : 'ies'} skipped` : ''}${r.usedBackup ? `; campaign file was damaged — restored from backup ${r.usedBackup}` : ''}.`);
    this.scheduleBroadcast();
    return this.current;
  }

  /* ------------------------------------------------------------- engine plumbing */
  dispatch(action, payload, actor, opts = {}) {
    const res = this.current.engine.dispatch(action, payload, actor, opts);
    if (action.startsWith('char.gcs') || action === 'char.importGcs' || action === 'char.delete') this.gcs.syncLinks(this.current.state);
    return res;
  }

  changed() { this.scheduleBroadcast(); }

  scheduleBroadcast() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => { this.broadcastTimer = null; for (const c of this.clients) this.sendView(c); }, 25);
  }

  sendView(c) {
    if (c.ws.readyState !== 1) return;
    try {
      const view = viewFor(this.current.state, c.session);
      view.campaignId = this.current.id;
      view.host = this.hostInfo(c.session);
      c.ws.send(JSON.stringify({ type: 'view', view }));
    } catch (e) { this.log.error?.('view error', e); }
  }

  hostInfo(session) {
    const base = { port: this.port, lan: this.bindAddress === '0.0.0.0', notes: this.systemNotes.slice(-20) };
    if (session.role !== 'gm') return { ...base, notes: this.systemNotes.filter(n => n.public).slice(-10) };
    return { ...base, gcs: this.gcs.status(), tts: this.tts.status(), ttsSelection: this.ttsSelection, campaigns: this.store.list(), recovery: this.current.recovery, addresses: this.lanAddresses(), legacyAvailable: !!(this.legacyDataFile && fs.existsSync(this.legacyDataFile)) };
  }

  lanAddresses() {
    const out = [];
    for (const [name, list] of Object.entries(require('node:os').networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    return out;
  }

  notify(kind, text, pub = false) {
    this.systemNotes.push({ id: crypto.randomBytes(4).toString('hex'), at: new Date().toISOString(), kind, text, public: pub });
    if (this.systemNotes.length > 100) this.systemNotes.shift();
    this.broadcastSystem();
  }
  broadcastSystem() { this.scheduleBroadcast(); }

  /* ------------------------------------------------------------- GCS */
  gcsChanged(charId, text, file) {
    const c = this.current?.state.characters[charId];
    if (!c || c.gcs?.sync === 'paused') return;
    try {
      const r = this.dispatch('char.importGcs', { id: charId, text, fileName: path.basename(file), path: file }, { role: 'gm' });
      if (!r.result?.unchanged) this.notify('gcs', `${c.name}: synchronized from GCS (${r.result.changes.length} change${r.result.changes.length === 1 ? '' : 's'}).`, true);
    } catch (e) { this.notify('gcs', `${c.name}: GCS import failed — ${e.message}`); }
  }

  /* ------------------------------------------------------------- TTS */
  ttsMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'select' || m.type === 'link') {
      const s = this.current.state;
      const charId = m.npcId && s.characters[m.npcId] ? m.npcId : s.tts.links[m.guid];
      this.ttsSelection = { guid: m.guid || null, name: m.name || '', charId: charId || null, at: new Date().toISOString() };
      if (m.type === 'link' && m.npcId && m.guid && s.characters[m.npcId]) this.dispatch('tts.link', { charId: m.npcId, guid: m.guid }, { role: 'gm' });
      this.scheduleBroadcast();
    } else if (m.type === 'log' && m.text) this.notify('tts', `TTS: ${String(m.text).slice(0, 300)}`);
  }

  ttsTokenPayload(charIds) {
    const s = this.current.state;
    return charIds.map((id, i) => {
      const c = s.characters[id];
      if (!c) return null;
      const portrait = c.portrait && s.assets[c.portrait] ? `http://127.0.0.1:${this.port}/assets/${s.assets[c.portrait].file}` : null;
      return { npcId: c.id, name: c.name, faction: c.faction || '', kind: c.kind, image: portrait, index: i, description: this.ttsStatusText(c) };
    }).filter(Boolean);
  }

  ttsStatusText(c) {
    const d = require('../core/characters').derived(this.current.state, c);
    return `${c.faction || ''} · ${{ healthy: 'Unhurt', wounded: 'Wounded', reeling: 'Badly wounded', critical: 'Collapsing', unconscious: 'Down', dead: 'Dead' }[d.state] || ''}`.trim();
  }

  /* ------------------------------------------------------------- HTTP */
  sessionFromReq(req) {
    const m = /(?:^|;\s*)sgc=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
    return m ? this.sessions.get(m[1]) || null : null;
  }

  cookie(res, t) { res.setHeader('set-cookie', `sgc=${t}; HttpOnly; SameSite=Strict; Path=/`); }

  async http(req, res) {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = decodeURIComponent(u.pathname);
    res.setHeader('x-content-type-options', 'nosniff');
    if (p === '/' && (u.searchParams.get('gm') || u.searchParams.get('pt'))) {
      const gm = u.searchParams.get('gm'), pt = u.searchParams.get('pt');
      if (gm && gm === this.gmToken) this.cookie(res, gm);
      else if (pt && this.oneTime.has(pt)) { const t = token(); this.sessions.set(t, this.oneTime.get(pt)); this.oneTime.delete(pt); this.cookie(res, t); }
      res.writeHead(302, { location: '/' }); return res.end();
    }
    if (p === '/' || p === '/index.html') return this.file(res, path.join(ROOT, 'src', 'ui', 'index.html'));
    if (p.startsWith('/ui/')) return this.file(res, path.join(ROOT, 'src', 'ui', p.slice(4)), path.join(ROOT, 'src', 'ui'));
    if (p.startsWith('/seed/')) return this.file(res, path.join(ROOT, 'data', 'seed', 'images', p.slice(6)), path.join(ROOT, 'data', 'seed', 'images'), 86400);
    if (p === '/tts/Global.lua') return this.file(res, path.join(ROOT, 'tts', 'Global.lua'));
    const session = this.sessionFromReq(req);
    if (p === '/api/whoami') return this.json(res, 200, { session: session ? { role: session.role, playerId: session.playerId || null } : null, campaign: this.current?.state.name, players: Object.values(this.current?.state.players || {}).filter(x => x.codeHash).map(x => ({ id: x.id, name: x.name })) });
    if (p === '/api/login' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}');
      const pl = this.current.state.players[body.playerId];
      if (!pl || !checkCode(body.code || '', pl.codeHash)) return this.json(res, 403, { error: 'Unknown player or wrong join code.' });
      const t = token(); this.sessions.set(t, { role: 'player', playerId: pl.id }); this.cookie(res, t);
      return this.json(res, 200, { ok: true });
    }
    if (p === '/tts/select' && req.method === 'POST') {
      // compatibility with the previous build's TTS script (WebRequest.post from TTS)
      const raw = (await readBody(req, 4096)).toString('utf8');
      const actorId = new URLSearchParams(raw).get('actorId') || (() => { try { return JSON.parse(raw).actorId; } catch { return null; } })();
      this.ttsMessage({ type: 'select', npcId: actorId });
      return this.json(res, 200, { ok: true });
    }
    if (!session) return this.json(res, 401, { error: 'Not signed in.' });
    if (p.startsWith('/assets/')) {
      const file = p.slice(8);
      if (!/^[a-f0-9]{64}\.(png|webp|jpg|jpeg|gif)$/.test(file)) return this.json(res, 400, { error: 'Bad asset' });
      return this.file(res, path.join(this.store.assetsDir(this.current.id), file), null, 86400 * 30);
    }
    if (session.role !== 'gm') return this.json(res, 403, { error: 'GM only.' });
    if (p === '/api/assets' && req.method === 'POST') {
      const buf = await readBody(req, 20 * 1024 * 1024);
      const kind = imageKind(buf);
      if (!kind) return this.json(res, 400, { error: 'Only PNG, JPEG, WebP or GIF images are supported.' });
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const file = `${sha}.${kind}`;
      const dest = path.join(this.store.assetsDir(this.current.id), file);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf, { flag: 'wx' }); // content-addressed; originals never overwritten
      const size = pngSize(buf) || { w: Number(req.headers['x-width']) || 0, h: Number(req.headers['x-height']) || 0 };
      const r = this.dispatch('asset.add', { file, id: sha.slice(0, 24), name: String(req.headers['x-name'] || file).slice(0, 120), w: size.w, h: size.h, derivedFrom: req.headers['x-derived-from'] || null }, { role: 'gm' });
      return this.json(res, 200, { id: r.result.id, file });
    }
    if (p === '/api/export') {
      const buf = this.store.exportPackage(this.current.id, this.current.state);
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${this.current.state.name.replace(/[^\w -]/g, '_')}.stalkercampaign"` });
      return res.end(buf);
    }
    if (p === '/api/import' && req.method === 'POST') {
      const buf = await readBody(req, 512 * 1024 * 1024);
      const id = this.store.importPackage(buf);
      return this.json(res, 200, { id });
    }
    if (p === '/api/export-character') {
      const c = this.current.state.characters[u.searchParams.get('id')];
      if (!c) return this.json(res, 404, { error: 'Not found' });
      const items = inv.descendants(this.current.state, 'char:' + c.id);
      const defs = {}; for (const it of items) { defs[it.defId] = this.current.state.defs[it.defId]; for (const [a] of it.rounds || []) defs[a] = this.current.state.defs[a]; }
      res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${c.name.replace(/[^\w -]/g, '_')}.stalkerchar.json"` });
      return res.end(JSON.stringify({ format: 'stalker-gurps-character', version: 1, character: c, items, defs }));
    }
    if (p === '/api/migrate' && req.method === 'POST') {
      const buf = await readBody(req, 64 * 1024 * 1024);
      return this.json(res, 200, this.migrate(JSON.parse(buf.toString('utf8'))));
    }
    return this.json(res, 404, { error: 'Not found' });
  }

  json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); }

  file(res, file, root, maxAge = 0) {
    const resolved = path.resolve(file);
    if (root && !resolved.startsWith(path.resolve(root) + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(resolved, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'cache-control': maxAge ? `max-age=${maxAge}` : 'no-cache' });
      res.end(data);
    });
  }

  /** Migrate a legacy save document into a NEW campaign (legacy data untouched). */
  migrate(doc) {
    const keys = doc?.keys || doc;
    if (!keys || typeof keys !== 'object') throw new ActionError('Not a legacy save file.');
    const { state, report, legacyImages } = migrateLegacy(keys, { name: 'Migrated campaign' });
    const id = this.store.create({ state });
    // copy images from the previous build's managed asset folder when present
    const legacyAssets = this.legacyDataFile ? path.join(path.dirname(path.dirname(this.legacyDataFile)), 'item-assets') : null;
    for (const file of legacyImages) {
      const src = legacyAssets && path.join(legacyAssets, file);
      if (src && fs.existsSync(src)) {
        const buf = fs.readFileSync(src);
        const kind = imageKind(buf);
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        fs.writeFileSync(path.join(this.store.assetsDir(id), `${sha}.${kind}`), buf);
        const st = JSON.parse(fs.readFileSync(path.join(this.store.campaignDir(id), 'campaign.json'), 'utf8'));
        const aid = sha.slice(0, 24);
        st.assets[aid] = { id: aid, file: `${sha}.${kind}`, name: file, w: pngSize(buf)?.w || 0, h: pngSize(buf)?.h || 0, crop: null, derivedFrom: null, addedAt: new Date().toISOString() };
        for (const d of Object.values(st.defs)) if (d.legacyImage === file) { d.image = aid; delete d.legacyImage; }
        fs.writeFileSync(path.join(this.store.campaignDir(id), 'campaign.json'), JSON.stringify(st));
        report.migrated.push(`Image ${file} copied into the campaign library.`);
      } else report.notTransferred.push(`Image ${file} was not found in the previous build's item-assets folder.`);
    }
    return { id, report };
  }

  /* ------------------------------------------------------------- WebSocket */
  connection(ws, session) {
    const c = { ws, session, alive: true };
    this.clients.add(c);
    ws.on('message', raw => this.message(c, raw));
    ws.on('close', () => this.clients.delete(c));
    ws.on('pong', () => { c.alive = true; });
    ws.send(JSON.stringify({ type: 'hello', role: session.role, playerId: session.playerId || null }));
    this.sendView(c);
  }

  async message(c, raw) {
    let m;
    try { m = JSON.parse(raw.toString('utf8')); } catch { return; }
    const reply = (ok, data) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: 'result', reqId: m.reqId, ok, ...data })); };
    try {
      if (m.type === 'action') {
        const r = this.dispatch(m.action, m.payload || {}, c.session, { requestId: m.requestId });
        return reply(true, { result: r.result, summary: r.summary, eventId: r.eventId, duplicate: !!r.duplicate });
      }
      if (m.type === 'host') { const result = await this.hostCommand(c.session, m.command, m.payload || {}); this.scheduleBroadcast(); return reply(true, { result }); }
      if (m.type === 'ping') return reply(true, { result: 'pong' });
    } catch (e) {
      if (!e.userFacing) this.log.error?.(e);
      return reply(false, { error: e.userFacing ? e.message : `Internal error: ${e.message}`, code: e.code || 'error' });
    }
  }

  async hostCommand(session, cmd, p) {
    if (session.role !== 'gm') throw new ActionError('Only the GM can do that.', 'forbidden');
    const oc = this.current;
    switch (cmd) {
      case 'campaigns': return this.store.list();
      case 'campaign.open': this.openCampaign(p.id); return { id: p.id };
      case 'campaign.create': { const id = this.store.create({ name: p.name, test: !!p.test }); if (p.open !== false) this.openCampaign(id); return { id }; }
      case 'campaign.delete': { if (p.id === oc.id) throw new ActionError('Open another campaign before deleting this one.'); this.store.delete(p.id); return true; }
      case 'save': oc.snapshot('manual'); return { saved: true };
      case 'backup': return { file: oc.backup(p.label || 'manual') };
      case 'backups': return this.store.backups(oc.id);
      case 'restore': oc.restore(p.file); this.gcs.syncLinks(oc.state); return { restored: true };
      case 'player.code': {
        const pl = oc.state.players[p.playerId]; if (!pl) throw new ActionError('Player not found.');
        const code = String(p.code || ''); if (code && code.length < 6) throw new ActionError('Join codes need at least 6 characters.');
        this.dispatch('player.save', { id: pl.id, codeHash: code ? hashCode(code) : null }, { role: 'gm' });
        return { set: !!code };
      }
      case 'player.link': { if (!oc.state.players[p.playerId]) throw new ActionError('Player not found.'); return { url: this.playerLink(p.playerId) }; }
      case 'lan': { this.dispatch('settings.update', { hostLan: !!p.enabled }, { role: 'gm' }); setTimeout(() => this.setLan(!!p.enabled).catch(e => this.notify('host', `LAN change failed: ${e.message}`)), 50); return { lan: !!p.enabled }; }
      case 'migrate.legacy': {
        if (!this.legacyDataFile || !fs.existsSync(this.legacyDataFile)) throw new ActionError('No save file from the previous build was found on this computer.');
        return this.migrate(JSON.parse(fs.readFileSync(this.legacyDataFile, 'utf8')));
      }
      case 'gcs.status': return this.gcs.status();
      case 'gcs.launch': { const c = p.charId ? oc.state.characters[p.charId] : null; return this.gcs.launch(c?.gcs?.path ? [c.gcs.path] : []); }
      case 'gcs.setExecutable': return this.gcs.setExecutable(p.path);
      case 'gcs.link': {
        const r = this.gcs.read(p.path);
        this.dispatch('char.importGcs', { id: p.charId, text: r.text, fileName: path.basename(p.path), path: path.resolve(p.path), force: true }, { role: 'gm' });
        this.dispatch('char.gcsLink', { id: p.charId, path: path.resolve(p.path), sync: 'auto' }, { role: 'gm' });
        return { linked: true };
      }
      case 'gcs.unlink': this.dispatch('char.gcsLink', { id: p.charId, path: null }, { role: 'gm' }); return { unlinked: true };
      case 'gcs.sync': { const c = oc.state.characters[p.charId]; if (!c?.gcs?.path) throw new ActionError('This character is not linked to a GCS file.'); const r = this.gcs.read(c.gcs.path); return this.dispatch('char.importGcs', { id: c.id, text: r.text, fileName: path.basename(c.gcs.path), path: c.gcs.path, force: !!p.force }, { role: 'gm' }).result; }
      case 'tts.start': return this.tts.start();
      case 'tts.stop': this.tts.stop(); return this.tts.status();
      case 'tts.ping': await this.tts.ping(); return this.tts.status();
      case 'tts.spawn': { const ok = await this.tts.call('spawn', { tokens: this.ttsTokenPayload(p.charIds || []), origin: p.origin || null }); if (!ok) throw new ActionError(this.tts.status().lastError || 'Could not reach Tabletop Simulator.'); return { sent: true }; }
      case 'tts.status': { const s = oc.state; const tokens = Object.entries(s.tts.links).filter(([, id]) => s.characters[id]).map(([guid, id]) => ({ guid, name: s.characters[id].name, description: this.ttsStatusText(s.characters[id]) })); const ok = await this.tts.call('status', { tokens }); if (!ok) throw new ActionError(this.tts.status().lastError || 'Could not reach Tabletop Simulator.'); return { sent: tokens.length }; }
      default: throw new ActionError(`Unknown host command ${cmd}`);
    }
  }
}

module.exports = { Host, hashCode, checkCode };
