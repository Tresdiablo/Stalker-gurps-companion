'use strict';
/**
 * Migration from earlier builds (Build 4.5 / Integrated Beta 0.8 / Unified Desktop 0.9).
 *
 * Input: the legacy key/value save map — either the desktop save file
 * (%APPDATA%/STALKER GURPS Companion/character-data/profiles.json: { version, keys: {...} }),
 * a browser localStorage export, or a single exported profile JSON.
 *
 * Output: a new campaign with every profile converted to a player character, the GM's NPC
 * templates, encounters (as archived records), traders and notes — plus a precise report of
 * anything that could not be transferred. The legacy data itself is never modified.
 */
const { Context } = require('./context');
const campaign = require('./campaign');
const cat = require('./catalog');
const inv = require('./inventory');
const chars = require('./characters');
const gcs = require('./gcs');
const traders = require('./traders');

const KEYS = { index: 'stalker-gurps-profiles-v2', data: 'stalker-gurps-profile-data-v2:', single: 'stalker-gurps-inventory-v1', gm: 'stalker-gurps-companion-gm-v4' };

const SLOT_MAP = { helmet: 'helmet', mask: 'face', vest: 'rig', armor: 'armor', backpack: 'backpack', primary1: 'primary', primary2: 'secondary', secondary: 'holster' };

function parseJson(text) { try { return typeof text === 'string' ? JSON.parse(text) : text; } catch { return null; } }

/** Convert a legacy catalog entry to a new definition. */
function convertDef(t, report) {
  const g = t.gurps || {};
  const base = { id: t.id, name: t.name || 'Unnamed item', tier: t.tier, w: t.w || 1, h: t.h || 1, weight: Number(t.weight) || 0, value: Number(t.value) || 0, description: t.description || '', stack: Number(t.stackSize) || 1, image: '', legacyId: t.id };
  if (typeof t.image === 'string' && t.image) {
    if (/^[\w.-]+\.(webp|png|jpg)$/.test(t.image)) base.image = 'seed:' + t.image;
    else if (t.image.startsWith('stalker-asset://files/')) base.legacyImage = t.image.slice('stalker-asset://files/'.length);
    else if (t.image.startsWith('asset:')) report.push(`"${base.name}": image stored in browser IndexedDB (${t.image}) cannot be read by the migration; re-import the PNG in the Item Editor.`);
  }
  const cal = cat.caliberKey(g.caliber || '');
  switch (t.category) {
    case 'Weapon': {
      const skill = g.skill || 'Guns (Rifle)';
      const sub = /pistol/i.test(skill) ? 'Pistols' : /smg/i.test(skill) ? 'Submachine Guns' : /shotgun/i.test(skill) ? 'Shotguns' : /melee|knife|sword|axe/i.test(skill) ? 'Melee Weapons' : 'Rifles';
      const melee = sub === 'Melee Weapons';
      const fam = Array.isArray(t.magFamilies) ? t.magFamilies : t.magFamily ? [t.magFamily] : [];
      const families = fam.length ? fam : (cal ? ['legacy-' + cal] : []);
      if (!fam.length && cal) report.push(`"${base.name}": had no magazine family; created family "legacy-${cal}" (matches magazines of the same caliber that also had none).`);
      return { ...base, category: 'weapon', sub, weapon: melee ? { kind: 'melee', skill, damage: g.damage || 'sw cut', reach: g.reach || 'C,1', parry: g.parry || '0' } : { kind: 'ranged', skill, damage: g.damage || '2d pi', acc: Number(g.acc) || 0, range: g.range || '', rof: g.rof || '1', shots: g.shots || '', bulk: Number(g.bulk) || 0, rcl: Number(g.rcl) || 2, minST: Number(g.minST) || 0, calibers: cal ? [cal] : [], magFamilies: t.integralFeed ? [] : families, integral: t.integralFeed ? { capacity: Number(g.capacity) || 1 } : null, mounts: [{ id: 'optic', slot: 'optic', interfaces: ['picatinny', 'ak-dovetail'], x: 0.45, y: 0.12, scale: 0.28, z: 3 }, { id: 'muzzle', slot: 'muzzle', interfaces: ['thread-' + cal, 'legacy-direct-thread'], x: 0.98, y: 0.3, scale: 0.22, z: 2 }] } };
    }
    case 'Magazine': return { ...base, category: 'magazine', sub: 'Rifle', magazine: { family: t.magFamily || (cal ? 'legacy-' + cal : 'legacy'), capacity: Number(g.capacity) || 10, calibers: cal ? [cal] : [] } };
    case 'Ammo': return { ...base, category: 'ammo', sub: 'Rifle', stack: Number(t.stackSize) || 30, ammo: { caliber: cal, label: /hp|hollow/i.test(t.name) ? 'HP' : 'FMJ', ...(/\b(hp|hollow)/i.test(t.name) ? { woundShift: 1, divisor: 0.5 } : {}) } };
    case 'Optic': return { ...base, category: 'attachment', sub: 'Optics', attachment: { slot: 'optic', interfaces: [mountIface(t.mountType)], mods: { acc: Number(g.acc) || 0 } } };
    case 'Suppressor': return { ...base, category: 'attachment', sub: 'Muzzle Devices', attachment: { slot: 'muzzle', interfaces: [mountIface(t.mountType || 'Direct-thread'), 'thread-' + cal], mods: { note: 'Suppressed' } } };
    case 'Upgrade Kit': report.push(`"${base.name}": upgrade kits are now ordinary attachments; converted to a side-rail accessory without automatic stat changes.`); return { ...base, category: 'attachment', sub: 'Tactical Devices', attachment: { slot: 'side', interfaces: ['picatinny'], mods: {} } };
    case 'Armor': case 'Helmet': case 'Mask': case 'Clothing': {
      const sub = t.category === 'Helmet' ? 'Helmets' : t.category === 'Mask' ? 'Masks' : t.category === 'Clothing' ? 'Clothing' : 'Body Armor';
      const locs = t.category === 'Helmet' ? ['skull'] : t.category === 'Mask' ? ['face'] : ['torso', 'vitals'];
      const d = { ...base, category: 'armor', sub, armor: { dr: Number(g.dr) || 0, locations: locs, dt: Number(t.dt || g.dt) || 0 } };
      if (t.category === 'Armor' && t.armorStorage) d.container = { grids: [{ id: 'main', label: 'Storage', w: t.storageW || 4, h: t.storageH || 2, compartments: t.compartments || [] }] };
      return d;
    }
    case 'Vest': return { ...base, category: 'equipment', sub: 'Tactical Rigs', container: { grids: [{ id: 'pouches', label: 'Pouches', w: t.storageW || 4, h: t.storageH || 2, compartments: t.compartments || [] }] } };
    case 'Backpack': return { ...base, category: 'equipment', sub: 'Backpacks', container: { grids: [{ id: 'main', label: 'Main compartment', w: t.storageW || 4, h: t.storageH || 2, compartments: t.compartments || [] }] } };
    case 'Medical': return { ...base, category: 'medical', sub: 'Medkits', consumable: { uses: Number(t.uses) || 1 } };
    case 'Artifact': return { ...base, category: 'artifact', sub: 'Miscellaneous', artifact: { effects: [t.description || ''] } };
    case 'Crafting Material': return { ...base, category: 'material', sub: 'Parts' };
    case 'Tactical Equipment': return { ...base, category: 'equipment', sub: 'Tools' };
    default: return { ...base, category: 'misc', sub: '' };
  }
}

function mountIface(m) {
  return { Picatinny: 'picatinny', Weaver: 'picatinny', 'AK dovetail': 'ak-dovetail', 'Direct-thread': 'legacy-direct-thread', 'QD muzzle': 'legacy-direct-thread' }[m] || 'picatinny';
}

/**
 * Migrate a legacy key map into a fresh campaign state.
 * @param {Record<string,string>} keys
 * @returns {{ state: object, report: { migrated: string[], notTransferred: string[], warnings: string[] } }}
 */
function migrateLegacy(keys, { name = 'Migrated campaign', ctx = new Context() } = {}) {
  // the starter catalog is used only to resolve legacy item ids; unused entries are pruned at the end
  const s = campaign.emptyCampaign(ctx, { name, seedCatalog: true });
  const starterIds = new Set(Object.keys(s.defs));
  const report = { migrated: [], notTransferred: [], warnings: [] };
  const legacyImages = new Set();
  const index = parseJson(keys[KEYS.index]);
  const profiles = [];
  if (index?.records?.length) for (const r of index.records) { const data = parseJson(keys[KEYS.data + r.id]); if (data) profiles.push({ id: r.id, name: r.name, data }); else report.notTransferred.push(`Profile "${r.name}" has no saved data.`); }
  if (!profiles.length) { const one = parseJson(keys[KEYS.single]); if (one?.items) profiles.push({ id: 'main', name: one.identity?.Name || 'Main Character', data: one }); }
  const gm = parseJson(keys[KEYS.gm]) || {};

  const ensureDef = (t, owner) => {
    if (!t) return null;
    const seedDef = s.defs[t.id];
    if (seedDef) {
      if (Number(t.value) > 0 && Number(t.value) !== seedDef.value) { seedDef.value = Number(t.value); report.migrated.push(`Kept your price ${t.value} ₽ for ${seedDef.name}.`); }
      if (typeof t.image === 'string' && t.image.startsWith('stalker-asset://files/')) { seedDef.legacyImage = t.image.slice(22); legacyImages.add(seedDef.legacyImage); }
      return seedDef;
    }
    const notes = [];
    const d = convertDef(t, notes);
    try { s.defs[d.id] = cat.normalizeDef(d); if (d.legacyImage) legacyImages.add(d.legacyImage); for (const m of notes) (/IndexedDB/.test(m) ? report.notTransferred : report.warnings).push(m); return s.defs[d.id]; }
    catch (e) { report.notTransferred.push(`Catalog item "${t.name}" (${owner}): ${e.message}`); return null; }
  };

  for (const p of profiles) {
    const st = p.data;
    for (const t of st.catalog || []) ensureDef(t, p.name);
    let build = null;
    if (st.gcs?.data) {
      try { build = gcs.parseGcs(JSON.stringify(st.gcs.data), { fileName: st.gcs.fileName || '' }).build; delete build.portrait; report.migrated.push(`${p.name}: GCS character data imported.`); }
      catch (e) { report.warnings.push(`${p.name}: stored GCS data could not be read (${e.message}); manual statistics used.`); }
    }
    if (!build) {
      const x = st.stats || {};
      build = chars.blankBuild(st.identity?.Name || p.name);
      Object.assign(build, { st: num(x.ST, 10), dx: num(x.DX, 10), iq: num(x.IQ, 10), ht: num(x.HT, 10), hp: num(x.HP, 10), fp: num(x.FP, 10), will: num(x.Will, num(x.IQ, 10)), per: num(x.Per, num(x.IQ, 10)), basicSpeed: num(x['Basic Speed'], 5), basicMove: num(x['Basic Move'], 5), dodge: num(x.Dodge, 8) });
      build.skills = (st.manualSkills || []).map(m => { const sp = chars.splitSkill(m.name); return { name: sp.name, spec: m.specialization || sp.spec, level: num(m.level, 10), points: num(m.points, 0), rsl: '' }; });
    }
    const c = chars.newCharacter(ctx, { kind: 'pc', name: st.identity?.Name || p.name, build, faction: st.identity?.Faction || '' });
    const rankIdx = chars.RANKS.findIndex(r => r.toLowerCase() === String(st.identity?.Rank || '').toLowerCase());
    if (rankIdx >= 0) c.rank = rankIdx + 1; else if (st.identity?.Rank) report.warnings.push(`${c.name}: rank "${st.identity.Rank}" is not one of the eight campaign ranks; set it in the Character Manager.`);
    c.session.hp = num(st.conditions?.Health, build.hp);
    c.session.fp = num(st.conditions?.Fatigue, build.fp);
    c.session.money = Math.max(0, Math.floor(num(st.money, 0)));
    c.session.posture = String(st.posture || 'standing').toLowerCase() === 'prone' ? 'prone' : String(st.posture || 'standing').toLowerCase() in { standing: 1, crouching: 1, kneeling: 1, sitting: 1, crawling: 1 } ? String(st.posture).toLowerCase() : 'standing';
    for (const [flag, on] of Object.entries(st.statusFlags || {})) if (on) c.session.conditions.push(flag === 'Crippled limb' ? 'Crippled Arm' : flag);
    if (num(st.conditions?.Bleeding, 0) > 0) c.session.conditions.push('Bleeding');
    if (num(st.conditions?.Radiation, 0) > 0) { c.session.conditions.push('Irradiated'); c.session.notes += `Radiation (legacy value): ${st.conditions.Radiation}\n`; }
    if (st.identity?.Reputation) c.session.notes += `Reputation: ${st.identity.Reputation}\n`;
    if (st.ext?.notes || st.journal) c.session.notes += String(st.ext?.notes || st.journal || '');
    s.characters[c.id] = c;
    const stash = { id: ctx.uid('st_'), name: `${c.name}'s stash`, grid: { w: 10, h: 30 }, access: [], hidden: false, ownerCharId: c.id };
    s.stashes[stash.id] = stash;
    migrateItems(s, ctx, st, c, stash, ensureDef, report);
    report.migrated.push(`${c.name}: ${inv.descendants(s, 'char:' + c.id).length + inv.descendants(s, 'stash:' + stash.id).length} items, HP ${c.session.hp}/${build.hp}, ${c.session.money} ₽.`);
  }

  // GM data: NPC templates, encounter history, traders, notes
  for (const n of gm.npcs || []) {
    const st = n.stats || {};
    const b = chars.blankBuild(n.name);
    Object.assign(b, { source: 'template', st: num(st.ST, 10), dx: num(st.DX, 10), iq: num(st.IQ, 10), ht: num(st.HT, 10), hp: num(st.HP, 10), fp: num(st.HT, 10), dodge: num(st.Dodge, 8), naturalDR: n.dr ? { all: num(n.dr, 0) } : {} });
    b.skills = [{ name: 'Guns', spec: 'Rifle', level: num(n.skill, 11), points: 0, rsl: '' }, { name: 'Guns', spec: 'Pistol', level: num(n.skill, 11), points: 0, rsl: '' }, { name: 'Guns', spec: 'SMG', level: num(n.skill, 11), points: 0, rsl: '' }, { name: 'Guns', spec: 'Shotgun', level: num(n.skill, 11), points: 0, rsl: '' }];
    if (!(n.loadout || []).some(g => s.defs[g.templateId]?.weapon)) b.weapons = [{ id: 'legacy', owner: 'Attack', usage: '', kind: 'ranged', level: num(n.skill, 11), damage: n.damage || '2d pi', rof: String(n.shots || 1), rcl: '2', skill: 'Guns' }];
    const id = 'tpl-legacy-' + String(n.id).replace(/[^\w-]/g, '').slice(0, 40);
    s.npcTemplates[id] = { id, name: n.name, archetype: n.type || 'Human', faction: n.faction || '', rank: 2, quality: 'standard', build: b, loadout: (n.loadout || []).filter(g => s.defs[g.templateId]).map(g => ({ slot: s.defs[g.templateId].weapon ? 'primary' : (cat.slotsFor(s.defs[g.templateId])[0] || 'backpack'), options: [g.templateId], mags: [1, 2] })), loot: [], notes: n.notes || '' };
    if (n.dt) report.warnings.push(`NPC "${n.name}": legacy DT ${n.dt} kept only as a note; enable the campaign armor rules and give it armor with DT.`);
    report.migrated.push(`NPC template "${n.name}".`);
  }
  for (const e of gm.encounters || []) {
    const enc = { id: ctx.uid('enc_'), name: e.name || 'Legacy encounter', status: 'archived', round: 0, turn: 0, order: [], combatants: {}, env: { darkness: 0, weather: 0, notes: `${e.location || ''}\nLegacy roster: ${(e.roster || []).map(r => `${r.name} (HP ${r.hp}/${r.maxHP})`).join(', ')}` }, distances: {}, createdAt: ctx.now(), endedAt: null, lootReleased: [] };
    s.encounters[enc.id] = enc;
    for (const sh of e.stashes || []) {
      const st = { id: ctx.uid('st_'), name: sh.name || 'Legacy stash', grid: { w: 10, h: 10 }, access: sh.revealed ? 'all' : [], hidden: !sh.revealed, notes: `From encounter ${enc.name}` };
      s.stashes[st.id] = st;
      for (const it of sh.items || []) { const d = s.defs[it.templateId]; if (!d) { report.notTransferred.push(`Stash "${st.name}": unknown item ${it.templateId}.`); continue; } placeNew(s, ctx, d, it.quantity || 1, 'stash:' + st.id, report); }
    }
    report.migrated.push(`Encounter "${enc.name}" (archived; legacy roster recorded in its notes).`);
  }
  for (const t of gm.integrated?.traders || []) {
    const type = { Medic: 'medic', Technician: 'technician', Weapons: 'weapons', Armor: 'armor', Equipment: 'equipment' }[t.category] || 'general';
    const tr = traders.newTrader(ctx, { name: t.name, type });
    tr.buyMult = num(t.priceBuy, 1); tr.sellMult = num(t.priceSell, 0.5);
    s.traders[tr.id] = tr;
    for (const line of t.stock || []) { const d = s.defs[line.templateId]; if (!d) { report.notTransferred.push(`Trader "${t.name}": unknown stock item ${line.templateId}.`); continue; } placeNew(s, ctx, d, line.qty || 1, 'trader:' + tr.id, report, true); }
    report.migrated.push(`Trader "${tr.name}".`);
  }
  if (gm.campaign) { s.name = gm.campaign.name || s.name; s.notes = [gm.campaign.notes, gm.zoneNotes].filter(Boolean).join('\n\n'); }
  for (const h of (gm.history || []).slice(0, 300).reverse()) s.log.unshift({ id: ctx.uid('log_'), at: h.when || ctx.now(), who: 'GM', role: 'gm', action: 'legacy', summary: `[legacy] ${h.kind}: ${h.details}`, gmOnly: true });
  if ((gm.integrated?.transactions || []).length) report.warnings.push(`${gm.integrated.transactions.length} legacy trader transactions were kept only in the campaign log text.`);
  if ((gm.checkpoints || []).length || (gm.integrated?.snapshots || []).length) report.notTransferred.push('Legacy in-browser checkpoints/snapshots are not converted (they hold old-format data). The original save file is untouched and can still be restored in the old build.');
  pruneUnusedStarter(s, starterIds);
  return { state: s, report, legacyImages: [...legacyImages] };
}

/** Keep only starter definitions that migrated items, NPC gear, trader stock or recipes actually use. */
function pruneUnusedStarter(s, starterIds) {
  const used = new Set();
  for (const it of Object.values(s.items)) { used.add(it.defId); for (const [a] of it.rounds || []) used.add(a); if (it.chamber) used.add(it.chamber); }
  for (const t of Object.values(s.npcTemplates)) if (String(t.id).startsWith('tpl-legacy-')) for (const l of t.loadout || []) for (const o of l.options || []) used.add(typeof o === 'string' ? o : o.defId);
  for (const id of starterIds) if (!used.has(id)) delete s.defs[id];
  for (const [id, r] of Object.entries(s.recipes)) if ([...r.inputs.map(x => x.defId), ...(r.tools || []), r.output?.defId].filter(Boolean).some(d => !s.defs[d])) delete s.recipes[id];
  for (const t of Object.values(s.npcTemplates)) {
    t.loadout = (t.loadout || []).map(l => ({ ...l, options: (l.options || []).filter(o => s.defs[typeof o === 'string' ? o : o.defId]) })).filter(l => l.options.length);
    t.loot = (t.loot || []).filter(l => s.defs[l.defId]);
  }
}

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

function placeNew(s, ctx, d, qty, ref, report, grow = false) {
  let left = Math.max(1, Math.floor(qty));
  while (left > 0) {
    const it = inv.createItem(s, ctx, d.id, { qty: Math.min(left, d.stack) });
    left -= it.qty;
    let spot = inv.findSpot(s, it, ref);
    if (!spot && grow && ref.startsWith('trader:')) { s.traders[ref.slice(7)].grid.h += 20; spot = inv.findSpot(s, it, ref); }
    if (!spot) { delete s.items[it.id]; report.notTransferred.push(`${d.name}: no room in ${ref}.`); return; }
    inv.place(s, it, spot);
  }
}

function migrateItems(s, ctx, st, c, stash, ensureDef, report) {
  const charRef = 'char:' + c.id;
  const legacy = st.items || [];
  const byOld = new Map();
  const defFor = it => s.defs[it.templateId] || ensureDef({ ...it, id: it.templateId || it.id }, c.name);
  // pass 1: create instances
  for (const old of legacy) {
    if (old.integralMagazine && old.location === 'loaded') continue; // folded into the weapon below
    const d = defFor(old);
    if (!d) { report.notTransferred.push(`${c.name}: item "${old.name}" has no usable definition.`); continue; }
    const it = { id: ctx.uid('it_'), defId: d.id, qty: Math.max(1, Math.min(d.stack, Math.floor(num(old.quantity, 1)))), cond: 100 };
    if (num(old.quantity, 1) > d.stack) report.warnings.push(`${c.name}: stack of ${old.quantity} ${d.name} exceeded the stack size; split automatically.`);
    if (d.magazine || d.weapon?.integral) it.rounds = [];
    if (d.magazine && num(old.loadedRounds, 0) > 0) {
      const ammo = s.defs[old.loadedAmmoTemplateId] || Object.values(s.defs).find(a => a.ammo && a.name === old.loadedAmmoType);
      if (ammo) it.rounds = [[ammo.id, Math.min(d.magazine.capacity, Math.floor(old.loadedRounds))]];
      else report.notTransferred.push(`${c.name}: ${old.loadedRounds} rounds of "${old.loadedAmmoType || 'unknown ammo'}" in ${d.name} — ammunition type not found.`);
    }
    if (old.uses !== undefined && old.uses !== null && d.consumable?.uses) it.uses = num(old.uses, d.consumable.uses);
    s.items[it.id] = it;
    byOld.set(old.id, { it, old, d });
    const extra = num(old.quantity, 1) - it.qty;
    if (extra > 0) placeNew(s, ctx, d, extra, 'stash:' + stash.id, report);
  }
  // integral magazines -> weapon rounds
  for (const old of legacy.filter(o => o.integralMagazine && o.location === 'loaded')) {
    const w = byOld.get(old.weaponId);
    if (!w || !w.d.weapon?.integral) continue;
    const ammo = s.defs[old.loadedAmmoTemplateId] || Object.values(s.defs).find(a => a.ammo && a.name === old.loadedAmmoType);
    if (num(old.loadedRounds, 0) > 0) { if (ammo) w.it.rounds = [[ammo.id, Math.min(w.d.weapon.integral.capacity, Math.floor(old.loadedRounds))]]; else report.notTransferred.push(`${c.name}: rounds in ${w.d.name}'s internal magazine — ammunition type not found.`); }
  }
  const fallback = (entry, reason) => {
    const { it, d } = entry;
    it.loc = null;
    try { inv.storeOnCharacter(s, it, charRef, { allowGround: false }); report.warnings.push(`${c.name}: ${d.name} could not keep its old position (${reason}); placed in carried storage.`); return; } catch { /* next */ }
    const spot = inv.findSpot(s, it, 'stash:' + stash.id);
    if (spot) { inv.place(s, it, spot); report.warnings.push(`${c.name}: ${d.name} could not keep its old position (${reason}); moved to ${stash.name}.`); return; }
    report.notTransferred.push(`${c.name}: ${d.name} — no room anywhere.`); delete s.items[it.id];
  };
  const tryPlace = (entry, target, reason) => { try { inv.place(s, entry.it, target); return true; } catch (e) { fallback(entry, `${reason}: ${e.message}`); return false; } };
  // pass 2: equipment slots first (containers must exist before their contents)
  const ordered = [...byOld.values()].sort((a, b) => (a.old.location === 'slot' ? 0 : 1) - (b.old.location === 'slot' ? 0 : 1));
  const slotHolder = {};
  for (const e of ordered) {
    const { old } = e;
    if (old.location === 'slot') {
      if (/^pocket[1-4]$/.test(old.slot)) { tryPlace(e, { p: charRef, g: 'pockets', x: Number(old.slot.slice(6)) - 1, y: 0, r: 0 }, 'pocket'); continue; }
      const slot = SLOT_MAP[old.slot];
      if (!slot) { fallback(e, `legacy slot "${old.slot}" no longer exists`); continue; }
      if (tryPlace(e, { p: charRef, slot }, 'equipment slot')) slotHolder[old.slot] = e.it;
    }
  }
  for (const e of ordered) {
    const { old } = e;
    if (old.location === 'slot') continue;
    if (old.location === 'vestGrid' || old.location === 'backpackGrid') {
      const holder = old.location === 'vestGrid' ? (slotHolder.vest || slotHolder.armor) : slotHolder.backpack;
      const grid = holder ? inv.defOf(s, holder).container?.grids[0] : null;
      if (!grid) { fallback(e, 'its container is not equipped'); continue; }
      tryPlace(e, { p: 'item:' + holder.id, g: grid.id, x: num(old.x, 0), y: num(old.y, 0), r: old.rotated ? 1 : 0 }, 'container grid');
    } else if (old.location === 'loaded' && old.weaponId) {
      const w = byOld.get(old.weaponId);
      if (!w) { fallback(e, 'its weapon no longer exists'); continue; }
      try { e.it.loc = null; require('./weapons').insertMagazine(s, w.it, e.it); } catch (err) { fallback(e, `could not be inserted (${err.message})`); }
    } else if (old.location === 'installed' && old.weaponId) {
      const w = byOld.get(old.weaponId);
      if (!w) { fallback(e, 'its weapon no longer exists'); continue; }
      try { e.it.loc = null; require('./weapons').installAttachment(s, w.it, e.it); } catch (err) { fallback(e, `attachment no longer compatible (${err.message})`); }
    } else {
      // loose loot -> the character's stash (legacy "loose" was not carried)
      const spot = inv.findSpot(s, e.it, 'stash:' + stash.id);
      if (spot) inv.place(s, e.it, spot); else fallback(e, 'stash full');
    }
  }
}

module.exports = { migrateLegacy, convertDef, KEYS };
