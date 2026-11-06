'use strict';
/**
 * Native GURPS Character Sheet integration.
 *
 * The complete official GCS application (Go/Unison, MPL-2.0) is bundled with the installer and
 * launched as its own native window. The companion links each character to an original .gcs
 * file, watches it, and imports GCS's saved calculations whenever GCS saves. The companion never
 * writes to .gcs files.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { MAX_FILE_BYTES } = require('../core/gcs');

class GcsService {
  /**
   * @param {object} o
   * @param {string} o.configFile where the chosen gcs executable path is stored
   * @param {string} [o.resourcesPath] Electron resources path (bundled GCS in <resources>/gcs)
   * @param {string} [o.appPath] application root (vendor/gcs during development)
   * @param {(charId:string, text:string, file:string) => void} o.onChange
   */
  constructor({ configFile, resourcesPath = '', appPath = '', env = process.env, onChange = () => {}, onError = () => {} }) {
    this.configFile = configFile;
    this.resourcesPath = resourcesPath;
    this.appPath = appPath;
    this.env = env;
    this.onChange = onChange;
    this.onError = onError;
    this.watches = new Map(); // charId -> { file, listener, timer, lastMtime }
    this.config = this.readConfig();
  }

  readConfig() {
    try { const x = JSON.parse(fs.readFileSync(this.configFile, 'utf8')); return { exe: typeof x.exe === 'string' ? x.exe : null }; }
    catch { /* none yet */ }
    // previous builds stored the executable in gcs-workspace.json / gcs-integration.json
    for (const old of ['gcs-workspace.json', 'gcs-integration.json']) {
      try { const x = JSON.parse(fs.readFileSync(path.join(path.dirname(this.configFile), old), 'utf8')); const exe = x.exe || x.executable; if (typeof exe === 'string') return { exe }; } catch { /* continue */ }
    }
    return { exe: null };
  }
  saveConfig() { fs.mkdirSync(path.dirname(this.configFile), { recursive: true }); fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2)); }

  candidates() {
    const exeName = process.platform === 'win32' ? 'gcs.exe' : 'gcs';
    const dirs = [
      path.join(this.resourcesPath, 'gcs'),
      path.join(this.appPath, 'vendor', 'gcs'),
      path.join(this.env.LOCALAPPDATA || '', 'Programs', 'GCS'),
      path.join(this.env.ProgramFiles || '', 'GCS'),
      path.join(this.env['ProgramFiles(x86)'] || '', 'GCS'),
      '/usr/local/bin', '/usr/bin', '/Applications/GCS.app/Contents/MacOS',
    ];
    return [this.config.exe, ...dirs.map(d => path.join(d, exeName))].filter(Boolean);
  }

  executable() {
    for (const f of this.candidates()) { try { if (fs.statSync(f).isFile()) return f; } catch { /* continue */ } }
    return null;
  }

  status() {
    const exe = this.executable();
    return { available: !!exe, executable: exe, bundled: !!exe && !!this.resourcesPath && exe.startsWith(path.join(this.resourcesPath, 'gcs')), watching: [...this.watches.entries()].map(([charId, w]) => ({ charId, file: w.file, exists: fs.existsSync(w.file) })) };
  }

  setExecutable(file) {
    const base = path.basename(file).toLowerCase();
    if (!['gcs.exe', 'gcs'].includes(base) || !fs.statSync(file).isFile()) throw new Error('Choose the GCS program (gcs.exe).');
    this.config.exe = path.resolve(file);
    this.saveConfig();
    return this.status();
  }

  /** Launch GCS, optionally opening character files. */
  launch(files = []) {
    const exe = this.executable();
    if (!exe) throw new Error('GCS was not found. Run the Windows setup (it bundles GCS) or locate gcs.exe in Settings.');
    const args = files.filter(f => typeof f === 'string' && f.toLowerCase().endsWith('.gcs') && fs.existsSync(f));
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
    child.on('error', e => this.onError(e));
    child.unref();
    return { launched: true, executable: exe, files: args };
  }

  /** Read and validate a .gcs file (no parsing of game data here). */
  read(file) {
    if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.gcs') throw new Error('Choose a GCS character file (.gcs).');
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0 || st.size > MAX_FILE_BYTES) throw new Error('The GCS file is empty or too large.');
    const text = fs.readFileSync(file, 'utf8');
    JSON.parse(text.replace(/^﻿/, '')); // throws while GCS is mid-save; caller retries
    return { text, mtime: st.mtimeMs, file };
  }

  /** Watch a linked file; GCS writes atomically, so polling the mtime is reliable. */
  watch(charId, file) {
    this.unwatch(charId);
    const w = { file, lastMtime: 0, timer: null };
    try { w.lastMtime = fs.statSync(file).mtimeMs; } catch { /* missing for now */ }
    w.listener = (cur) => {
      if (!cur.mtimeMs || cur.mtimeMs === w.lastMtime) return;
      w.lastMtime = cur.mtimeMs;
      clearTimeout(w.timer);
      w.timer = setTimeout(() => this.deliver(charId, file, 0), 400);
    };
    fs.watchFile(file, { interval: 1000, persistent: false }, w.listener);
    this.watches.set(charId, w);
  }

  deliver(charId, file, attempt) {
    try { const r = this.read(file); this.onChange(charId, r.text, file); }
    catch (e) { if (attempt < 5) setTimeout(() => this.deliver(charId, file, attempt + 1), 500); else this.onError(e, charId); }
  }

  unwatch(charId) {
    const w = this.watches.get(charId);
    if (!w) return;
    fs.unwatchFile(w.file, w.listener);
    clearTimeout(w.timer);
    this.watches.delete(charId);
  }

  /** Make the watch list match the campaign's character links. */
  syncLinks(state) {
    const wanted = new Map();
    for (const c of Object.values(state.characters || {})) if (c.gcs?.path && c.gcs.sync !== 'paused') wanted.set(c.id, c.gcs.path);
    for (const id of [...this.watches.keys()]) if (!wanted.has(id) || wanted.get(id) !== this.watches.get(id).file) this.unwatch(id);
    for (const [id, file] of wanted) if (!this.watches.has(id)) this.watch(id, file);
  }

  close() { for (const id of [...this.watches.keys()]) this.unwatch(id); }
}

module.exports = { GcsService };
