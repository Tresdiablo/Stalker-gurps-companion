'use strict';
/**
 * GCS desktop integration service.
 * The .gcs document belongs to GCS: the companion NEVER edits it.
 * Only file links, hashes and a user-selected gcs.exe path are persisted here.
 * Built-in fs.watchFile is used to avoid extra dependencies/native modules.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');

const MAX_GCS_BYTES = 16 * 1024 * 1024;
const PROFILE_ID = /^[a-zA-Z0-9_-]{1,96}$/;

function assertProfileId(id) {
  if (typeof id !== 'string' || !PROFILE_ID.test(id)) throw Error('Invalid character profile identifier.');
  return id;
}
function isCharacterData(data) {
  return !!data && typeof data === 'object' && !Array.isArray(data) &&
    (data.attributes && typeof data.attributes === 'object' ||
      Array.isArray(data.skills) || Array.isArray(data.traits) ||
      data.profile && typeof data.profile === 'object');
}
function readCharacterFile(file) {
  if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.gcs')
    throw Error('Select a GCS character document (.gcs).');
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_GCS_BYTES || stat.size === 0)
    throw Error('GCS character must be a nonempty file smaller than 16 MB.');
  const raw = fs.readFileSync(file);
  if (raw.length > MAX_GCS_BYTES) throw Error('GCS character exceeds 16 MB.');
  let data;
  try { data = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw Error('The GCS character is not valid UTF-8 JSON. Wait for GCS to finish saving.'); }
  if (!isCharacterData(data)) throw Error('This file does not contain a recognizable GCS character.');
  return {
    name: path.basename(file),
    path: file,
    content: JSON.stringify(data),
    hash: crypto.createHash('sha256').update(raw).digest('hex'),
    modifiedAt: stat.mtime.toISOString()
  };
}
function atomicWriteJson(file, data) {
  const tmp = file + '.new';
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {encoding:'utf8', mode:0o600});
  fs.renameSync(tmp, file);
}
class GcsService {
  constructor({userData, resourcesPath, appPath, env = process.env, onFileChange = () => {}, notifyLaunchError = () => {}}) {
    if (!userData) throw Error('userData path required');
    this.configFile = path.join(userData, 'gcs-workspace.json');
    this.resourcesPath = resourcesPath || '';
    this.appPath = appPath || '';
    this.env = env;
    this.onFileChange = onFileChange;
    this.notifyLaunchError = notifyLaunchError;
    this.watches = new Map();
    this.config = this.readConfig();
    for (const [id, file] of Object.entries(this.config.links)) {
      if (PROFILE_ID.test(id) && typeof file === 'string') this.watch(id, file);
    }
  }
  readConfig() {
    try {
      const x = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      if (x && typeof x === 'object' && !Array.isArray(x))
        return {exe: typeof x.exe === 'string' ? x.exe : null,
          links: x.links && typeof x.links === 'object' && !Array.isArray(x.links) ? x.links : {}};
    } catch { /* no new-format configuration yet */ }
    // Preserve the manually selected GCS executable from the previous beta bridge.
    try {
      const older=JSON.parse(fs.readFileSync(path.join(path.dirname(this.configFile),'gcs-integration.json'),'utf8'));
      if(typeof older.executable==='string')return {exe:older.executable,links:{}};
    } catch { /* first installation */ }
    return {exe:null, links:{}};
  }
  saveConfig() { atomicWriteJson(this.configFile, this.config); }
  candidates() {
    const dirs = [
      path.join(this.resourcesPath, 'gcs'),
      path.join(this.appPath, 'vendor', 'gcs'),
      path.join(this.env.LOCALAPPDATA || '', 'Programs', 'GCS'),
      path.join(this.env.ProgramFiles || '', 'GCS'),
      path.join(this.env['ProgramFiles(x86)'] || '', 'GCS')
    ];
    return [this.config.exe, ...dirs.map(d=>path.join(d, 'gcs.exe'))].filter(Boolean);
  }
  executable() {
    for (const file of this.candidates()) {
      try { if (fs.statSync(file).isFile() && path.basename(file).toLowerCase() === 'gcs.exe') return file; }
      catch { /* continue */ }
    }
    return null;
  }
  status(profileId) {
    const exe = this.executable();
    const result = {available:!!exe, bundled: !!exe && exe.startsWith(path.join(this.resourcesPath,'gcs') + path.sep), executable:exe};
    if (profileId !== undefined) {
      assertProfileId(profileId);
      const file = this.config.links[profileId];
      let exists=false;
      try { exists=!!file && fs.statSync(file).isFile(); } catch { /* missing file */ }
      result.linked=!!file; result.file=file||null; result.exists=exists;
    }
    return result;
  }
  setExecutable(file) {
    if(typeof file !== 'string' || path.basename(file).toLowerCase() !== 'gcs.exe' || !fs.statSync(file).isFile())
      throw Error('Choose the original gcs.exe executable.');
    this.config.exe = path.resolve(file);
    this.saveConfig();
    return this.status();
  }
  link(profileId, file) {
    assertProfileId(profileId);
    const payload = readCharacterFile(file);  // Validate before changing a link.
    this.unwatch(profileId);
    this.config.links[profileId] = path.resolve(file);
    this.saveConfig();
    this.watch(profileId, this.config.links[profileId]);
    return payload;
  }
  unlink(profileId) {
    assertProfileId(profileId);
    this.unwatch(profileId);
    delete this.config.links[profileId];
    this.saveConfig();
    return this.status(profileId);
  }
  read(profileId) {
    assertProfileId(profileId);
    const file = this.config.links[profileId];
    if (!file) throw Error('No GCS character linked to this profile.');
    return readCharacterFile(file);
  }
  watch(profileId, file) {
    // Poll the linked path rather than an inode. GCS can replace files atomically.
    // Take the baseline synchronously so a save immediately after linking is found.
    let previous;
    try { previous = fs.statSync(file); }
    catch { previous = {mtimeMs:0,size:0}; }
    const poll = setInterval(() => {
      let current;
      try { current = fs.statSync(file); }
      catch { current = {mtimeMs:0,size:0}; }
      if(current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
        previous = current;
        this.onFileChange(profileId);
      }
    }, 1200);
    poll.unref();
    this.watches.set(profileId,{poll});
  }
  unwatch(profileId) {
    const current = this.watches.get(profileId);
    if (current) { clearInterval(current.poll); this.watches.delete(profileId); }
  }
  close() { for (const id of [...this.watches.keys()]) this.unwatch(id); }
}
module.exports = {GcsService, readCharacterFile, isCharacterData, assertProfileId, MAX_GCS_BYTES};
