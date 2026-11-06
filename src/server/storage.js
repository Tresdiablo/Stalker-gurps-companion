'use strict';
/**
 * Campaign storage on the local file system.
 *
 *   <root>/campaigns.json                     index of campaigns
 *   <root>/campaigns/<id>/campaign.json       last snapshot (atomic write: tmp + fsync + rename)
 *   <root>/campaigns/<id>/journal.ndjson      every committed action since the snapshot (fsync'd)
 *   <root>/campaigns/<id>/backups/*.json.gz   rotating and named backups
 *   <root>/campaigns/<id>/assets/<sha256>.png managed image library (originals never modified)
 *   <root>/campaigns/<id>/session.lock        present while open; left behind after a crash
 *
 * Recovery: load the snapshot, then replay journal entries newer than the snapshot. Because
 * each entry carries its random/id/time tape, replay reproduces the exact state.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Engine } = require('../core/engine');
const { Context } = require('../core/context');
const campaign = require('../core/campaign');

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

class CampaignStore {
  constructor(root) {
    this.root = root;
    this.dir = path.join(root, 'campaigns');
    fs.mkdirSync(this.dir, { recursive: true });
    this.indexFile = path.join(root, 'campaigns.json');
  }

  index() {
    try { const x = readJson(this.indexFile); return { campaigns: Array.isArray(x.campaigns) ? x.campaigns : [], last: x.last || null }; }
    catch { return { campaigns: [], last: null }; }
  }
  saveIndex(idx) { writeAtomic(this.indexFile, JSON.stringify(idx, null, 2)); }

  campaignDir(id) { if (!SAFE_ID.test(id)) throw new Error('Invalid campaign id'); return path.join(this.dir, id); }
  assetsDir(id) { const d = path.join(this.campaignDir(id), 'assets'); fs.mkdirSync(d, { recursive: true }); return d; }

  list() {
    const idx = this.index();
    return idx.campaigns.filter(c => fs.existsSync(path.join(this.campaignDir(c.id), 'campaign.json')));
  }

  /** Create a new campaign; returns its id. */
  create({ name, test = false, state = null } = {}) {
    const s = state || campaign.emptyCampaign(new Context(), { name: name || 'S.T.A.L.K.E.R. Campaign', test });
    if (name) s.name = name;
    if (test) s.test = true;
    const dir = this.campaignDir(s.id);
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    writeAtomic(path.join(dir, 'campaign.json'), JSON.stringify(s));
    const idx = this.index();
    idx.campaigns = idx.campaigns.filter(c => c.id !== s.id).concat([{ id: s.id, name: s.name, test: !!s.test, createdAt: s.createdAt, updatedAt: new Date().toISOString() }]);
    this.saveIndex(idx);
    return s.id;
  }

  /**
   * Open a campaign: returns an OpenCampaign with an Engine. Reports crash recovery.
   */
  open(id, hooks = {}) {
    const dir = this.campaignDir(id);
    const snapFile = path.join(dir, 'campaign.json');
    const journalFile = path.join(dir, 'journal.ndjson');
    const lockFile = path.join(dir, 'session.lock');
    const recovery = { crashed: fs.existsSync(lockFile), replayed: 0, skipped: 0, snapshotError: null, usedBackup: null };
    let state;
    try { state = readJson(snapFile); }
    catch (e) {
      recovery.snapshotError = e.message;
      const b = this.backups(id)[0];
      if (!b) throw new Error(`Campaign file is unreadable (${e.message}) and no backup exists.`);
      state = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backups', b.file))).toString('utf8'));
      recovery.usedBackup = b.file;
    }
    const migrationReport = campaign.migrate(state);
    const engine = new Engine(state);
    if (fs.existsSync(journalFile)) {
      const lines = fs.readFileSync(journalFile, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { recovery.skipped++; continue; } // torn final write
        if (entry.seq <= (engine.state.meta.seq || 0)) continue;
        try { engine.replay(entry); recovery.replayed++; } catch { recovery.skipped++; }
      }
    }
    const oc = new OpenCampaign(this, id, engine, { journalFile, lockFile, snapFile, recovery, migrationReport, hooks });
    oc.snapshot('open'); // fold the journal into a fresh snapshot
    writeAtomic(lockFile, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    const idx = this.index(); idx.last = id; const rec = idx.campaigns.find(c => c.id === id); if (rec) { rec.name = engine.state.name; rec.updatedAt = new Date().toISOString(); } this.saveIndex(idx);
    return oc;
  }

  backups(id) {
    const dir = path.join(this.campaignDir(id), 'backups');
    try {
      return fs.readdirSync(dir).filter(f => f.endsWith('.json.gz')).map(f => { const st = fs.statSync(path.join(dir, f)); return { file: f, size: st.size, at: st.mtime.toISOString(), named: f.includes('__') }; }).sort((a, b) => b.file.localeCompare(a.file));
    } catch { return []; }
  }

  delete(id) {
    const dir = this.campaignDir(id);
    fs.rmSync(dir, { recursive: true, force: true });
    const idx = this.index(); idx.campaigns = idx.campaigns.filter(c => c.id !== id); if (idx.last === id) idx.last = null; this.saveIndex(idx);
  }

  /** Portable package: gzip JSON containing the campaign and every referenced asset file. */
  exportPackage(id, state) {
    const assetsDir = this.assetsDir(id);
    const assets = {};
    for (const a of Object.values(state.assets || {})) {
      const f = path.join(assetsDir, a.file);
      if (fs.existsSync(f)) assets[a.file] = fs.readFileSync(f).toString('base64');
    }
    return zlib.gzipSync(Buffer.from(JSON.stringify({ format: 'stalker-gurps-campaign', version: 1, exportedAt: new Date().toISOString(), campaign: state, assets })));
  }

  importPackage(buffer, { asNew = true } = {}) {
    let doc;
    try { doc = JSON.parse(zlib.gunzipSync(buffer).toString('utf8')); } catch { doc = JSON.parse(buffer.toString('utf8')); }
    if (doc.format !== 'stalker-gurps-campaign' || !doc.campaign) throw new Error('Not a campaign package.');
    const s = doc.campaign;
    if (asNew || this.list().some(c => c.id === s.id)) { s.id = 'cmp_' + crypto.randomBytes(9).toString('base64url'); s.name = `${s.name} (imported)`; }
    s.meta = { ...(s.meta || {}), seq: s.meta?.seq || 0, processed: {} };
    const id = this.create({ state: s });
    const dir = this.assetsDir(id);
    for (const [file, b64] of Object.entries(doc.assets || {})) if (/^[a-f0-9]{64}\.(png|webp|jpg|jpeg|gif)$/.test(file)) fs.writeFileSync(path.join(dir, file), Buffer.from(b64, 'base64'));
    return id;
  }
}

class OpenCampaign {
  constructor(store, id, engine, opts) {
    this.store = store;
    this.id = id;
    this.engine = engine;
    this.journalFile = opts.journalFile;
    this.lockFile = opts.lockFile;
    this.snapFile = opts.snapFile;
    this.recovery = opts.recovery;
    this.migrationReport = opts.migrationReport;
    this.dirtySince = null;
    this.actionsSinceSnapshot = 0;
    this.lastBackupAt = 0;
    this.journalFd = null;
    engine.hooks.journal = entry => this.journal(entry);
    const userChanged = opts.hooks.changed;
    engine.hooks.changed = info => { this.markDirty(); if (userChanged) userChanged(info); };
    this.timer = setInterval(() => this.tick(), 2000);
    this.timer.unref?.();
  }
  get state() { return this.engine.state; }

  journal(entry) {
    if (this.journalFd === null) this.journalFd = fs.openSync(this.journalFile, 'a');
    fs.writeSync(this.journalFd, JSON.stringify(entry) + '\n');
    fs.fsyncSync(this.journalFd);
    this.actionsSinceSnapshot++;
  }

  markDirty() { if (!this.dirtySince) this.dirtySince = Date.now(); }

  tick() {
    const every = (this.state.settings?.autosaveSeconds || 20) * 1000;
    if (this.dirtySince && (Date.now() - this.dirtySince > every || this.actionsSinceSnapshot > 200)) this.snapshot('autosave');
    if (Date.now() - this.lastBackupAt > 15 * 60 * 1000 && this.actionsSinceSnapshot === 0 && this.dirtySince === null && this.lastBackupAt) { /* nothing new */ }
  }

  /** Write a full snapshot atomically and start a new journal. */
  snapshot(reason = 'manual') {
    writeAtomic(this.snapFile, JSON.stringify(this.state));
    if (this.journalFd !== null) { fs.closeSync(this.journalFd); this.journalFd = null; }
    try { fs.truncateSync(this.journalFile, 0); } catch { /* none */ }
    this.actionsSinceSnapshot = 0;
    this.dirtySince = null;
    if (reason === 'autosave' && Date.now() - this.lastBackupAt > 10 * 60 * 1000) this.backup('auto');
    if (reason === 'open') this.backup('open');
    return true;
  }

  /** gzip backup; named backups (label) are kept, automatic ones rotate (30 kept). */
  backup(label = 'auto') {
    const dir = path.join(this.store.campaignDir(this.id), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safe = String(label).replace(/[^\w-]/g, '_').slice(0, 40);
    const named = !['auto', 'open', 'before-restore'].includes(label);
    const file = `${stamp}${named ? '__' + safe : '_' + safe}.json.gz`;
    writeAtomic(path.join(dir, file), zlib.gzipSync(Buffer.from(JSON.stringify(this.state))));
    this.lastBackupAt = Date.now();
    const auto = this.store.backups(this.id).filter(b => !b.named);
    for (const b of auto.slice(30)) fs.rmSync(path.join(dir, b.file), { force: true });
    return file;
  }

  /** Restore a backup (a safety backup of the current state is made first). */
  restore(file) {
    if (!/^[\w.-]+\.json\.gz$/.test(file)) throw new Error('Invalid backup name.');
    const dir = path.join(this.store.campaignDir(this.id), 'backups');
    const state = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, file))).toString('utf8'));
    this.backup('before-restore');
    campaign.migrate(state);
    state.meta.seq = Math.max(state.meta.seq || 0, this.state.meta.seq || 0) + 1; // keep sequence monotonic
    this.engine.state = state;
    this.snapshot('restore');
    return true;
  }

  close() {
    clearInterval(this.timer);
    this.snapshot('close');
    try { fs.rmSync(this.lockFile, { force: true }); } catch { /* ignore */ }
  }
}

module.exports = { CampaignStore, OpenCampaign, writeAtomic };
