'use strict';
/**
 * The authoritative action engine.
 *
 * All changes to a campaign go through `Engine.dispatch(action, payload, actor, opts)`:
 *  1. permission check (role and ownership) — enforced here, not in the UI
 *  2. idempotency: a repeated requestId returns the first result without re-applying
 *  3. the handler runs on a draft copy; on any error the draft is discarded (atomic)
 *  4. the committed action is journaled (with its random/id/time tape) for crash recovery
 *  5. an audit log entry is written (GM overrides are recorded automatically)
 *
 * actor: { role: 'gm' } | { role: 'player', playerId }
 */
const { Context } = require('./context');
const { ActionError, PermissionError, assert } = require('./errors');
const inv = require('./inventory');
const weapons = require('./weapons');
const chars = require('./characters');
const combat = require('./combat');
const traders = require('./traders');
const npcs = require('./npcs');
const crafting = require('./crafting');
const cat = require('./catalog');
const gcs = require('./gcs');
const campaign = require('./campaign');

const isGM = a => a && a.role === 'gm';
const MAX_PROCESSED = 3000;

function ownsChar(s, actor, charId) {
  if (isGM(actor)) return true;
  const c = s.characters[charId];
  return !!(c && c.kind === 'pc' && actor.role === 'player' && c.ownerId === actor.playerId);
}
function requireGM(actor) { if (!isGM(actor)) throw new PermissionError('Only the GM can do that.'); }
function requireOwn(s, actor, charId) { if (!ownsChar(s, actor, charId)) throw new PermissionError('You can only act for your own character.'); }

/** Can the actor take items out of / put items into a top-level container reference? */
function canUseRef(s, actor, ref, mode) {
  if (isGM(actor)) return true;
  if (!ref) return false;
  const { kind, id } = inv.parseRef(ref);
  if (kind === 'char') {
    if (ownsChar(s, actor, id)) return true;
    // looting a released NPC (take only)
    const c = s.characters[id];
    return mode === 'take' && c?.kind === 'npc' && Object.values(s.encounters).some(e => (e.lootReleased || []).includes(id));
  }
  if (kind === 'stash') {
    const st = s.stashes[id];
    return !!st && !st.hidden && (st.access === 'all' || (Array.isArray(st.access) && st.access.includes(actor.playerId)));
  }
  return false; // traders: buy/sell only
}

function itemRootFor(s, item) { return inv.rootOf(s, item); }

function requireItemAccess(s, actor, item, mode = 'take') {
  if (isGM(actor)) return;
  const root = itemRootFor(s, item);
  if (!canUseRef(s, actor, root, mode)) throw new PermissionError('You cannot reach that item.');
  if (item.hidden) throw new PermissionError('You cannot reach that item.');
}

function targetRoot(s, target) {
  const { kind, id } = inv.parseRef(target.p);
  if (kind !== 'item') return target.p;
  const it = s.items[id];
  assert(it, 'Destination no longer exists.');
  return inv.rootOf(s, it);
}

function audit(s, ctx, actor, action, summary, extra = {}) {
  const who = isGM(actor) ? 'GM' : (s.players[actor.playerId]?.name || 'Player');
  s.log.unshift({ id: ctx.uid('log_'), at: ctx.now(), who, role: actor.role, playerId: actor.playerId || null, action, summary, gmOnly: !!extra.gmOnly, eventId: extra.eventId || null, override: !!extra.override });
  if (s.log.length > 5000) s.log.length = 5000;
}

function str(v, max = 200) { return String(v ?? '').slice(0, max); }
function charName(s, id) { return s.characters[id]?.name || 'someone'; }

/* ==================================================================== handlers */
// Each handler: (s, ctx, p, actor, env) => { summary, gmOnly?, result?, eventId? }

const H = {};

/* ---------- campaign & players */
H['campaign.update'] = (s, ctx, p, a) => { requireGM(a); if (p.name !== undefined) s.name = str(p.name, 120); if (p.notes !== undefined) s.notes = str(p.notes, 100000); if (p.gmNotes !== undefined) s.gmNotes = str(p.gmNotes, 100000); return { summary: 'Updated campaign details', gmOnly: true }; };
H['settings.update'] = (s, ctx, p, a) => {
  requireGM(a);
  const changed = [];
  for (const [k, v] of Object.entries(p.rules || {})) if (k in campaign.DEFAULT_RULES) { if (s.settings.rules[k] !== v) changed.push(`${k}: ${s.settings.rules[k]} → ${v}`); s.settings.rules[k] = v; }
  if (p.economy) Object.assign(s.settings.economy, p.economy);
  if (Array.isArray(p.ranks)) s.settings.ranks = p.ranks.slice(0, 8);
  for (const k of ['perkPerRank', 'autosaveSeconds', 'hostLan', 'port']) if (p[k] !== undefined) s.settings[k] = p[k];
  return { summary: `Changed settings${changed.length ? ': ' + changed.join(', ') : ''}`, gmOnly: true };
};
H['player.save'] = (s, ctx, p, a) => {
  requireGM(a);
  const id = p.id || ctx.uid('pl_');
  const prev = s.players[id] || {};
  s.players[id] = { id, name: str(p.name || prev.name || 'Player', 60), codeHash: p.codeHash !== undefined ? p.codeHash : (prev.codeHash || null), color: p.color || prev.color || '#8db5a6' };
  return { summary: `Saved player ${s.players[id].name}`, gmOnly: true, result: { id } };
};
H['player.remove'] = (s, ctx, p, a) => { requireGM(a); assert(s.players[p.id], 'Player not found.'); for (const c of Object.values(s.characters)) if (c.ownerId === p.id) c.ownerId = null; delete s.players[p.id]; return { summary: 'Removed player', gmOnly: true }; };

/* ---------- characters */
H['char.create'] = (s, ctx, p, a) => {
  requireGM(a);
  const c = chars.newCharacter(ctx, { kind: p.kind === 'npc' ? 'npc' : 'pc', name: str(p.name || 'New Character', 80), ownerId: p.ownerId || null, faction: str(p.faction, 60) });
  s.characters[c.id] = c;
  if (c.kind === 'pc') { const st = { id: ctx.uid('st_'), name: `${c.name}'s stash`, grid: { w: 10, h: 20 }, access: c.ownerId ? [c.ownerId] : [], hidden: false, ownerCharId: c.id }; s.stashes[st.id] = st; }
  return { summary: `Created ${c.kind === 'npc' ? 'NPC' : 'character'} ${c.name}`, gmOnly: c.kind === 'npc', result: { id: c.id } };
};
H['char.update'] = (s, ctx, p, a) => {
  const c = s.characters[p.id]; assert(c, 'Character not found.');
  if (isGM(a)) {
    for (const k of ['name', 'nickname', 'faction', 'gmNotes', 'archetype']) if (p[k] !== undefined) c[k] = str(p[k], k === 'gmNotes' ? 50000 : 80);
    if (p.ownerId !== undefined) { assert(p.ownerId === null || s.players[p.ownerId], 'Unknown player.'); c.ownerId = p.ownerId; for (const st of Object.values(s.stashes)) if (st.ownerCharId === c.id) st.access = p.ownerId ? [p.ownerId] : []; }
    if (p.hidden !== undefined) c.hidden = !!p.hidden;
    if (p.reveal) c.reveal = { ...c.reveal, ...p.reveal };
    if (p.archived !== undefined) c.archived = !!p.archived;
  } else {
    requireOwn(s, a, c.id);
    for (const k of Object.keys(p)) if (!['id', 'nickname', 'notes', 'portrait'].includes(k)) throw new PermissionError('Only the GM can change that.');
    if (p.nickname !== undefined) c.nickname = str(p.nickname, 80);
  }
  if (p.notes !== undefined) c.session.notes = str(p.notes, 50000);
  if (p.portrait !== undefined) { assert(p.portrait === null || s.assets[p.portrait], 'Unknown image.'); c.portrait = p.portrait; }
  return { summary: `Updated ${c.name}`, gmOnly: c.kind === 'npc' };
};
H['char.delete'] = (s, ctx, p, a) => {
  requireGM(a);
  const c = s.characters[p.id]; assert(c, 'Character not found.');
  const items = inv.descendants(s, 'char:' + c.id);
  s.trash.unshift({ id: ctx.uid('tr_'), at: ctx.now(), kind: 'character', character: c, items });
  s.trash.length = Math.min(s.trash.length, 50);
  for (const it of items) delete s.items[it.id];
  delete s.characters[c.id];
  for (const e of Object.values(s.encounters)) if (e.combatants[c.id]) combat.removeCombatant(s, e, c.id);
  return { summary: `Deleted ${c.name} (restorable from trash)`, gmOnly: true };
};
H['trash.restore'] = (s, ctx, p, a) => {
  requireGM(a);
  const i = s.trash.findIndex(t => t.id === p.id); assert(i >= 0, 'Nothing to restore.');
  const t = s.trash[i];
  if (t.kind === 'character') { assert(!s.characters[t.character.id], 'Already restored.'); s.characters[t.character.id] = t.character; }
  for (const it of t.items) s.items[it.id] = it;
  s.trash.splice(i, 1);
  return { summary: `Restored ${t.character?.name || 'items'} from trash`, gmOnly: true };
};
H['char.manualBuild'] = (s, ctx, p, a) => { requireGM(a); const c = s.characters[p.id]; assert(c, 'Character not found.'); chars.updateManualBuild(c, p.build || {}); return { summary: `Edited build of ${c.name}`, gmOnly: c.kind === 'npc' }; };
H['char.importGcs'] = (s, ctx, p, a) => {
  const c = s.characters[p.id]; assert(c, 'Character not found.');
  if (!isGM(a)) requireOwn(s, a, c.id);
  const { build, hash } = gcs.parseGcs(p.text, { fileName: p.fileName || '' });
  if (c.gcs && c.gcs.hash === hash && !p.force) return { summary: `${c.name}: GCS file unchanged`, result: { unchanged: true } };
  const changes = gcs.diffBuilds(c.build?.source === 'gcs' ? c.build : null, build);
  const portrait = build.portrait; delete build.portrait;
  chars.applyImportedBuild(c, build);
  if (portrait && p.portraitAssetId) c.portrait = p.portraitAssetId;
  c.gcs = { ...(c.gcs || {}), path: p.path || c.gcs?.path || null, fileName: p.fileName || c.gcs?.fileName || '', hash, importedAt: ctx.now(), sync: c.gcs?.sync || 'auto', lastChanges: changes.slice(0, 200), gcsCurrent: build.gcsCurrent };
  const vitalsDiffer = build.gcsCurrent?.hp !== null && build.gcsCurrent?.hp !== undefined && build.gcsCurrent.hp !== c.session.hp;
  c.gcs.vitalsNote = vitalsDiffer ? `GCS sheet records HP ${build.gcsCurrent.hp}; the companion tracks ${c.session.hp}. The companion value is kept (session data).` : null;
  return { summary: `${c.name}: imported GCS sheet (${changes.length} change${changes.length === 1 ? '' : 's'})`, result: { changes, warnings: build.warnings } };
};
H['char.gcsLink'] = (s, ctx, p, a) => { const c = s.characters[p.id]; assert(c, 'Character not found.'); if (!isGM(a)) requireOwn(s, a, c.id); c.gcs = { ...(c.gcs || {}), path: p.path ?? c.gcs?.path ?? null, sync: p.sync || c.gcs?.sync || 'auto' }; return { summary: `${c.name}: GCS link ${p.sync === 'paused' ? 'paused' : 'updated'}` }; };
H['char.useGcsVitals'] = (s, ctx, p, a) => {
  const c = s.characters[p.id]; assert(c?.gcs?.gcsCurrent, 'No GCS vitals recorded.'); if (!isGM(a)) requireOwn(s, a, c.id);
  const before = { hp: c.session.hp, fp: c.session.fp };
  if (c.gcs.gcsCurrent.hp !== null) c.session.hp = c.gcs.gcsCurrent.hp;
  if (c.gcs.gcsCurrent.fp !== null) c.session.fp = c.gcs.gcsCurrent.fp;
  c.gcs.vitalsNote = null;
  return { summary: `${c.name}: replaced tracked HP/FP (${before.hp}/${before.fp}) with GCS values (${c.session.hp}/${c.session.fp})` };
};
H['char.adjust'] = (s, ctx, p, a) => {
  const c = s.characters[p.id]; assert(c, 'Character not found.');
  if (!isGM(a)) { requireOwn(s, a, c.id); assert(s.settings.rules.playerSelfAdjust, 'The GM has disabled manual HP/FP changes for players.'); }
  const ev = combat.manualAdjust(s, ctx, { charId: c.id, hp: p.hp, fp: p.fp, conditionsAdd: p.conditionsAdd || [], conditionsRemove: p.conditionsRemove || [], reason: p.reason }, a.role === 'gm' ? 'GM' : a.playerId);
  return { summary: ev.title, gmOnly: c.kind === 'npc', eventId: ev.id, result: { eventId: ev.id } };
};
H['char.posture'] = (s, ctx, p, a) => { const c = s.characters[p.id]; assert(c, 'Character not found.'); requireOwn(s, a, c.id); assert(require('./rules').POSTURES[p.posture], 'Unknown posture.'); c.session.posture = p.posture; for (const e of Object.values(s.encounters)) if (e.combatants[c.id]) e.combatants[c.id].posture = p.posture; return { summary: `${c.name} is now ${p.posture}`, gmOnly: c.kind === 'npc' }; };
H['char.money'] = (s, ctx, p, a) => {
  requireGM(a);
  const c = s.characters[p.id]; assert(c, 'Character not found.');
  const d = Math.trunc(Number(p.delta)); assert(Number.isFinite(d) && d !== 0, 'Enter an amount.');
  assert(c.session.money + d >= 0, 'Money cannot go below zero.');
  c.session.money += d;
  s.ledger.push({ id: ctx.uid('tx_'), at: ctx.now(), kind: 'gm', charId: c.id, price: -d, qty: 0, defId: null, reason: str(p.reason) });
  return { summary: `${c.name}: ${d > 0 ? '+' : ''}${d} ₽ (GM)`, gmOnly: c.kind === 'npc' };
};
H['char.giveMoney'] = (s, ctx, p, a) => {
  requireOwn(s, a, p.from);
  const from = s.characters[p.from], to = s.characters[p.to]; assert(from && to, 'Character not found.');
  const n = Math.trunc(Number(p.amount)); assert(n > 0 && from.session.money >= n, 'Not enough money.');
  from.session.money -= n; to.session.money += n;
  s.ledger.push({ id: ctx.uid('tx_'), at: ctx.now(), kind: 'transfer', charId: from.id, toCharId: to.id, price: n, qty: 0, defId: null });
  return { summary: `${from.name} gave ${n} ₽ to ${to.name}` };
};
H['rank.award'] = (s, ctx, p, a) => { requireGM(a); const c = s.characters[p.id]; assert(c, 'Character not found.'); const r = Math.floor(Number(p.rank)); assert(r >= 1 && r <= 8, 'Rank must be 1–8.'); const before = c.rank; c.rank = r; return { summary: `${c.name}: rank ${s.settings.ranks[before - 1]?.name || before} → ${s.settings.ranks[r - 1]?.name || r}`, gmOnly: c.kind === 'npc' }; };
H['perk.save'] = (s, ctx, p, a) => { requireGM(a); const id = p.id || ctx.uid('perk_'); s.perks[id] = { id, name: str(p.name, 80), description: str(p.description, 1000), minRank: Math.max(1, Math.min(8, Number(p.minRank) || 1)) }; return { summary: `Saved perk ${s.perks[id].name}`, gmOnly: true, result: { id } }; };
H['perk.delete'] = (s, ctx, p, a) => { requireGM(a); delete s.perks[p.id]; return { summary: 'Deleted perk', gmOnly: true }; };
H['perk.request'] = (s, ctx, p, a) => { requireOwn(s, a, p.charId); assert(s.perks[p.perkId], 'Unknown perk.'); s.perkRequests.push({ id: ctx.uid('pr_'), charId: p.charId, perkId: p.perkId, at: ctx.now(), status: 'pending' }); return { summary: `${charName(s, p.charId)} requests perk ${s.perks[p.perkId].name}` }; };
H['perk.grant'] = (s, ctx, p, a) => {
  requireGM(a);
  const c = s.characters[p.charId]; const perk = s.perks[p.perkId]; assert(c && perk, 'Character or perk not found.');
  assert(!c.perks.includes(perk.id), 'Already granted.');
  const allowed = (c.rank - 1) * (s.settings.perkPerRank || 1);
  const warn = c.perks.length >= allowed || c.rank < perk.minRank ? ' (exceeds rank allowance — GM override)' : '';
  c.perks.push(perk.id);
  for (const r of s.perkRequests) if (r.charId === c.id && r.perkId === perk.id && r.status === 'pending') r.status = 'approved';
  return { summary: `${c.name} gains perk ${perk.name}${warn}`, override: !!warn };
};
H['perk.revoke'] = (s, ctx, p, a) => { requireGM(a); const c = s.characters[p.charId]; assert(c, 'Character not found.'); c.perks = c.perks.filter(x => x !== p.perkId); for (const r of s.perkRequests) if (r.charId === c.id && r.perkId === p.perkId && r.status === 'pending') r.status = 'denied'; return { summary: `${c.name}: perk removed/denied` }; };

/* ---------- items */
H['item.spawn'] = (s, ctx, p, a) => {
  requireGM(a);
  const d = s.defs[p.defId]; assert(d, 'Unknown item.');
  let left = Math.max(1, Math.min(10000, Math.floor(Number(p.qty) || 1)));
  const made = [];
  while (left > 0) {
    const it = inv.createItem(s, ctx, d.id, { qty: Math.min(left, d.stack), cond: p.cond ?? 100, hidden: !!p.hidden });
    left -= it.qty;
    if (p.loadFull && (d.magazine || d.weapon?.integral)) {
      const ammo = Object.values(s.defs).find(x => x.id === p.ammoId) || cat.compatibleAmmo(s.defs, d)[0];
      if (ammo) it.rounds = [[ammo.id, d.magazine ? d.magazine.capacity : d.weapon.integral.capacity]];
    }
    if (p.target) inv.place(s, it, p.target);
    else if (p.to?.startsWith('char:')) inv.storeOnCharacter(s, it, p.to);
    else inv.storeIn(s, it, p.to);
    if (s.items[it.id]) made.push(it.id);
  }
  return { summary: `Spawned ${p.qty || 1} × ${d.name}${p.to ? ` for ${describeRef(s, p.to)}` : ''}`, gmOnly: !p.to?.startsWith('char:') || s.characters[p.to.slice(5)]?.kind === 'npc', result: { ids: made } };
};
function describeRef(s, ref) { try { const { kind, id } = inv.parseRef(ref); return { char: s.characters, stash: s.stashes, trader: s.traders }[kind]?.[id]?.name || ref; } catch { return ref; } }

H['item.move'] = (s, ctx, p, a) => {
  const it = inv.getItem(s, p.itemId);
  requireItemAccess(s, a, it, 'take');
  const dest = targetRoot(s, p.target);
  if (!isGM(a)) assert(canUseRef(s, a, dest, 'put'), 'You cannot put items there.');
  const from = inv.rootOf(s, it);
  if (p.target.mount !== undefined) {
    const w = inv.getItem(s, p.target.p.slice(5));
    const mount = weapons.mountsOf(s, w).find(m => m.id === p.target.mount);
    assert(mount, 'Unknown mount.');
    if (mount.slot === 'magazine') { it.loc = it.loc; weapons.insertMagazine(s, w, it); }
    else weapons.installAttachment(s, w, it, mount.id);
  } else inv.place(s, it, p.target);
  const gmOnly = [from, dest].every(r => r && r.startsWith('char:') && s.characters[r.slice(5)]?.kind === 'npc');
  return { summary: `Moved ${inv.itemName(s, it)}${from !== dest ? ` from ${describeRef(s, from)} to ${describeRef(s, dest)}` : ''}`, gmOnly, quiet: from === dest };
};
H['item.transfer'] = (s, ctx, p, a) => {
  const it = inv.getItem(s, p.itemId);
  requireItemAccess(s, a, it, 'take');
  if (!isGM(a)) assert(canUseRef(s, a, p.to, 'put'), 'You cannot put items there.');
  const from = inv.rootOf(s, it);
  it.loc = null;
  if (p.to.startsWith('char:')) inv.storeOnCharacter(s, it, p.to, { allowGround: p.allowGround !== false }); else inv.storeIn(s, it, p.to);
  return { summary: `Transferred ${inv.itemName(s, it)} from ${describeRef(s, from)} to ${describeRef(s, p.to)}` };
};
H['item.rotate'] = (s, ctx, p, a) => { const it = inv.getItem(s, p.itemId); requireItemAccess(s, a, it, 'put'); inv.rotate(s, it); return { summary: `Rotated ${inv.itemName(s, it)}`, quiet: true }; };
H['item.split'] = (s, ctx, p, a) => { const it = inv.getItem(s, p.itemId); requireItemAccess(s, a, it, 'put'); if (p.target && !isGM(a)) assert(canUseRef(s, a, targetRoot(s, p.target), 'put'), 'You cannot put items there.'); const n = inv.splitStack(s, ctx, it, p.qty, p.target); return { summary: `Split ${p.qty} × ${inv.itemName(s, it)}`, quiet: true, result: { id: n.id } }; };
H['item.merge'] = (s, ctx, p, a) => { const src = inv.getItem(s, p.srcId), dst = inv.getItem(s, p.dstId); requireItemAccess(s, a, src, 'take'); requireItemAccess(s, a, dst, 'put'); const n = inv.mergeStacks(s, src, dst); assert(n > 0, 'The stack is full.'); return { summary: `Stacked ${n} × ${inv.itemName(s, dst)}`, quiet: true }; };
H['item.drop'] = (s, ctx, p, a) => {
  const it = inv.getItem(s, p.itemId); requireItemAccess(s, a, it, 'take');
  const root = inv.rootOf(s, it); assert(root?.startsWith('char:'), 'Only carried items can be dropped.');
  it.loc = null;
  const spot = inv.findSpot(s, it, root, 'ground'); assert(spot && spot.g === 'ground', 'No room on the ground.');
  inv.place(s, it, spot);
  return { summary: `${charName(s, root.slice(5))} dropped ${inv.itemName(s, it)}` };
};
H['item.delete'] = (s, ctx, p, a) => {
  requireGM(a);
  const it = inv.getItem(s, p.itemId);
  const removed = inv.destroy(s, it);
  s.trash.unshift({ id: ctx.uid('tr_'), at: ctx.now(), kind: 'items', items: removed });
  s.trash.length = Math.min(s.trash.length, 50);
  return { summary: `Deleted ${s.defs[it.defId]?.name || 'item'} (restorable from trash)`, gmOnly: true };
};
H['item.update'] = (s, ctx, p, a) => {
  requireGM(a);
  const it = inv.getItem(s, p.itemId);
  if (p.cond !== undefined) it.cond = Math.max(0, Math.min(100, Math.round(Number(p.cond))));
  if (p.dp !== undefined) it.dp = Math.max(0, Math.round(Number(p.dp)));
  if (p.name !== undefined) it.name = str(p.name, 80) || undefined;
  if (p.notes !== undefined) it.notes = str(p.notes, 2000);
  if (p.hidden !== undefined) it.hidden = !!p.hidden;
  if (p.qty !== undefined) { const d = inv.defOf(s, it); it.qty = Math.max(1, Math.min(d.stack, Math.floor(Number(p.qty)))); }
  return { summary: `Edited ${inv.itemName(s, it)}`, gmOnly: true };
};
H['item.load'] = (s, ctx, p, a) => {
  const holder = inv.getItem(s, p.holderId); requireItemAccess(s, a, holder, 'put');
  const ammo = inv.getItem(s, p.ammoId); requireItemAccess(s, a, ammo, 'take');
  const n = weapons.loadRounds(s, holder, ammo, p.count);
  return { summary: `Loaded ${n} × ${s.defs[ammo.defId]?.name || 'rounds'} into ${inv.itemName(s, holder)}`, quiet: !isGM(a) ? false : true };
};
H['item.quickLoad'] = (s, ctx, p, a) => {
  const holder = inv.getItem(s, p.holderId); requireItemAccess(s, a, holder, 'put');
  const root = inv.rootOf(s, holder); assert(root?.startsWith('char:'), 'Quick load works on carried magazines.');
  const charId = root.slice(5);
  const top = holder.rounds?.length ? holder.rounds[holder.rounds.length - 1][0] : null;
  let choices = weapons.ammoChoices(s, charId, holder);
  if (p.ammoDefId) choices = choices.filter(c => c.defId === p.ammoDefId);
  else if (top) choices.sort((x, y) => (y.defId === top) - (x.defId === top));
  assert(choices.length, 'No compatible ammunition found.');
  let loaded = 0;
  for (const c of choices) {
    if (p.ammoDefId === undefined && top && c.defId !== top && loaded) break;
    if (weapons.roundCount(holder.rounds) >= weapons.holderCapacity(s, holder)) break;
    try { loaded += weapons.loadRounds(s, holder, c); } catch (e) { if (!e.userFacing) throw e; }
  }
  assert(loaded > 0, `${inv.itemName(s, holder)} is already full.`);
  return { summary: `Loaded ${loaded} rounds into ${inv.itemName(s, holder)}` };
};
H['item.unload'] = (s, ctx, p, a) => { const holder = inv.getItem(s, p.holderId); requireItemAccess(s, a, holder, 'take'); const t = weapons.unloadRounds(s, ctx, holder, p.to); return { summary: `Unloaded ${Object.values(t).reduce((x, y) => x + y, 0)} rounds from ${inv.itemName(s, holder)}` }; };
H['item.insertMag'] = (s, ctx, p, a) => { const w = inv.getItem(s, p.weaponId), m = inv.getItem(s, p.magId); requireItemAccess(s, a, w, 'put'); requireItemAccess(s, a, m, 'take'); const r = weapons.insertMagazine(s, w, m); return { summary: `Inserted ${inv.itemName(s, m)} into ${inv.itemName(s, w)}${r.chambered ? ' and chambered a round' : ''}` }; };
H['item.ejectMag'] = (s, ctx, p, a) => { const w = inv.getItem(s, p.weaponId); requireItemAccess(s, a, w, 'take'); if (p.target && !isGM(a)) assert(canUseRef(s, a, targetRoot(s, p.target), 'put'), 'You cannot put items there.'); const m = weapons.ejectMagazine(s, w, p.target); return { summary: `Ejected ${inv.itemName(s, m)} from ${inv.itemName(s, w)}` }; };
H['item.chamber'] = (s, ctx, p, a) => { const w = inv.getItem(s, p.weaponId); requireItemAccess(s, a, w, 'put'); weapons.chamberRound(s, w); return { summary: `Chambered a round in ${inv.itemName(s, w)}` }; };
H['item.attach'] = (s, ctx, p, a) => { const w = inv.getItem(s, p.weaponId), at = inv.getItem(s, p.attId); requireItemAccess(s, a, w, 'put'); requireItemAccess(s, a, at, 'take'); const m = weapons.installAttachment(s, w, at, p.mountId); return { summary: `Installed ${inv.itemName(s, at)} on ${inv.itemName(s, w)} (${m.label})` }; };
H['item.detach'] = (s, ctx, p, a) => { const w = inv.getItem(s, p.weaponId); requireItemAccess(s, a, w, 'take'); if (p.target && !isGM(a)) assert(canUseRef(s, a, targetRoot(s, p.target), 'put'), 'You cannot put items there.'); const at = weapons.removeAttachment(s, w, p.mountId, p.target); return { summary: `Removed ${inv.itemName(s, at)} from ${inv.itemName(s, w)}` }; };
H['item.use'] = (s, ctx, p, a) => {
  const it = inv.getItem(s, p.itemId); const root = inv.rootOf(s, it); assert(root?.startsWith('char:'), 'Use carried items.');
  requireOwn(s, a, root.slice(5));
  const ev = crafting.useConsumable(s, ctx, { charId: root.slice(5), itemId: it.id, targetId: p.targetId, byUser: a.playerId || 'GM' });
  return { summary: ev.title, eventId: ev.id, result: { eventId: ev.id } };
};

/* ---------- catalog & assets */
H['def.save'] = (s, ctx, p, a) => {
  requireGM(a);
  const d = cat.normalizeDef({ ...p.def, id: p.def.id || ctx.uid('def_') });
  if (d.image && !d.image.startsWith('seed:')) assert(s.assets[d.image], 'Unknown image asset.');
  const existed = !!s.defs[d.id];
  s.defs[d.id] = d;
  return { summary: `${existed ? 'Edited' : 'Created'} catalog item ${d.name}`, gmOnly: true, result: { id: d.id } };
};
H['def.delete'] = (s, ctx, p, a) => { requireGM(a); assert(s.defs[p.id], 'Not found.'); const n = Object.values(s.items).filter(i => i.defId === p.id).length; assert(!n, `${n} item(s) of this kind exist. Delete them first.`); const name = s.defs[p.id].name; delete s.defs[p.id]; return { summary: `Deleted catalog item ${name}`, gmOnly: true }; };
H['def.duplicate'] = (s, ctx, p, a) => { requireGM(a); const d = s.defs[p.id]; assert(d, 'Not found.'); const copy = JSON.parse(JSON.stringify(d)); copy.id = ctx.uid('def_'); copy.name = `${d.name} (copy)`; delete copy.legacyId; s.defs[copy.id] = cat.normalizeDef(copy); return { summary: `Duplicated ${d.name}`, gmOnly: true, result: { id: copy.id } }; };
H['def.import'] = (s, ctx, p, a) => {
  requireGM(a);
  const list = Array.isArray(p.defs) ? p.defs : [];
  let added = 0, updated = 0; const errors = [];
  for (const raw of list) { try { const d = cat.normalizeDef(raw); if (s.defs[d.id]) updated++; else added++; s.defs[d.id] = d; } catch (e) { errors.push(`${raw?.name || raw?.id || '?'}: ${e.message}`); } }
  return { summary: `Imported catalog: ${added} added, ${updated} updated${errors.length ? `, ${errors.length} rejected` : ''}`, gmOnly: true, result: { added, updated, errors } };
};
H['asset.add'] = (s, ctx, p, a) => { requireGM(a); assert(/^[a-f0-9]{64}\.(png|webp|jpg|jpeg|gif)$/.test(p.file), 'Invalid asset file.'); const id = p.id || p.file.split('.')[0].slice(0, 24); s.assets[id] = { id, file: p.file, name: str(p.name, 120), w: Number(p.w) || 0, h: Number(p.h) || 0, crop: p.crop || null, derivedFrom: p.derivedFrom || null, addedAt: ctx.now() }; return { summary: `Added image ${s.assets[id].name}`, gmOnly: true, result: { id } }; };
H['asset.update'] = (s, ctx, p, a) => { requireGM(a); const as = s.assets[p.id]; assert(as, 'Image not found.'); if (p.name !== undefined) as.name = str(p.name, 120); if (p.crop !== undefined) as.crop = p.crop; return { summary: `Edited image ${as.name}`, gmOnly: true }; };
H['asset.delete'] = (s, ctx, p, a) => { requireGM(a); const used = Object.values(s.defs).some(d => d.image === p.id || d.attachment?.art?.image === p.id) || Object.values(s.characters).some(c => c.portrait === p.id); assert(!used, 'Image is in use.'); delete s.assets[p.id]; return { summary: 'Removed image', gmOnly: true }; };

/* ---------- stashes */
H['stash.save'] = (s, ctx, p, a) => { requireGM(a); const id = p.id || ctx.uid('st_'); const prev = s.stashes[id] || {}; s.stashes[id] = { ...prev, id, name: str(p.name ?? prev.name ?? 'Stash', 80), grid: { w: Math.max(1, Math.min(30, Number(p.w ?? prev.grid?.w ?? 10))), h: Math.max(1, Math.min(200, Number(p.h ?? prev.grid?.h ?? 10))) }, access: p.access ?? prev.access ?? [], hidden: p.hidden ?? prev.hidden ?? false, notes: str(p.notes ?? prev.notes ?? '', 2000) }; return { summary: `Saved stash ${s.stashes[id].name}`, gmOnly: true, result: { id } }; };
H['stash.delete'] = (s, ctx, p, a) => { requireGM(a); assert(s.stashes[p.id], 'Not found.'); assert(!inv.childrenOf(s, 'stash:' + p.id).length, 'Empty the stash first.'); delete s.stashes[p.id]; return { summary: 'Deleted stash', gmOnly: true }; };

/* ---------- traders */
H['trader.save'] = (s, ctx, p, a) => {
  requireGM(a);
  let t = p.id ? s.traders[p.id] : null;
  if (!t) { t = traders.newTrader(ctx, p); s.traders[t.id] = t; }
  for (const k of ['name', 'notes']) if (p[k] !== undefined) t[k] = str(p[k], k === 'notes' ? 2000 : 80);
  if (p.type && traders.TRADER_TYPES[p.type]) t.type = p.type;
  if (p.tier !== undefined) t.tier = Math.max(1, Math.min(5, Math.floor(p.tier)));
  if (p.buyMult !== undefined) t.buyMult = Math.max(0, Number(p.buyMult));
  if (p.sellMult !== undefined) t.sellMult = Math.max(0, Number(p.sellMult));
  if (p.money !== undefined) t.money = p.money === null || p.money === '' ? null : Math.max(0, Math.floor(p.money));
  return { summary: `Saved trader ${t.name}`, gmOnly: true, result: { id: t.id } };
};
H['trader.generate'] = (s, ctx, p, a) => { requireGM(a); const ids = traders.generateStock(s, ctx, p.id, p.options || {}); return { summary: `Generated ${ids.length} stock items for ${s.traders[p.id].name}`, gmOnly: true }; };
H['trader.open'] = (s, ctx, p, a) => { requireGM(a); const t = traders.getTrader(s, p.id); t.open = true; t.openFor = Array.isArray(p.charIds) ? p.charIds.filter(id => s.characters[id]) : []; return { summary: `Opened ${t.name}'s shop${t.openFor.length ? ` for ${t.openFor.map(i => charName(s, i)).join(', ')}` : ' for everyone'}` }; };
H['trader.close'] = (s, ctx, p, a) => { requireGM(a); const t = traders.getTrader(s, p.id); t.open = false; return { summary: `Closed ${t.name}'s shop` }; };
H['trader.setPrice'] = (s, ctx, p, a) => { requireGM(a); const t = traders.getTrader(s, p.id); if (p.price === null || p.price === '') delete t.priceOverrides[p.itemId]; else t.priceOverrides[p.itemId] = Math.max(0, Math.round(Number(p.price))); return { summary: `Price changed at ${t.name}`, gmOnly: true }; };
H['trader.delete'] = (s, ctx, p, a) => { requireGM(a); const t = traders.getTrader(s, p.id); for (const it of inv.childrenOf(s, 'trader:' + t.id)) inv.destroy(s, it); delete s.traders[t.id]; return { summary: `Deleted trader ${t.name}`, gmOnly: true }; };
H['trader.buy'] = (s, ctx, p, a) => { requireOwn(s, a, p.charId); const r = traders.buy(s, ctx, p); return { summary: `${charName(s, p.charId)} bought ${r.qty} × ${s.defs[r.defId]?.name} for ${r.price} ₽${r.ground ? ' (placed on the ground — no inventory space)' : ''}`, result: r }; };
H['trader.sell'] = (s, ctx, p, a) => { requireOwn(s, a, p.charId); const r = traders.sell(s, ctx, p); return { summary: `${charName(s, p.charId)} sold ${r.qty} × ${s.defs[r.defId]?.name} for ${r.price} ₽`, result: r }; };

/* ---------- crafting & jobs */
H['recipe.save'] = (s, ctx, p, a) => { requireGM(a); const id = p.id || ctx.uid('rc_'); const r = { id, name: str(p.name, 120), inputs: (p.inputs || []).filter(x => s.defs[x.defId] && x.qty > 0).map(x => ({ defId: x.defId, qty: Math.floor(x.qty) })), tools: (p.tools || []).filter(t => s.defs[t]), skill: p.skill?.name ? { name: str(p.skill.name, 80), mod: Number(p.skill.mod) || 0 } : null, output: p.output?.defId ? { defId: p.output.defId, qty: Math.max(1, Math.floor(p.output.qty || 1)) } : null, repair: p.repair || null, time: str(p.time, 60), notes: str(p.notes, 1000), loseOnFailure: !!p.loseOnFailure, enabled: p.enabled !== false }; assert(r.name && r.inputs.length && (r.output || r.repair), 'A recipe needs a name, inputs and a result.'); s.recipes[id] = r; return { summary: `Saved recipe ${r.name}`, gmOnly: true, result: { id } }; };
H['recipe.delete'] = (s, ctx, p, a) => { requireGM(a); delete s.recipes[p.id]; return { summary: 'Deleted recipe', gmOnly: true }; };
H['craft.make'] = (s, ctx, p, a) => { requireOwn(s, a, p.charId); const r = crafting.craft(s, ctx, p); const rc = s.recipes[p.recipeId]; return { summary: `${charName(s, p.charId)} ${r.success ? 'crafted' : 'failed to craft'} ${rc.name}${r.roll ? ` (rolled ${r.roll.total} vs ${r.roll.effective})` : ''}${r.lost ? ' — materials lost' : ''}`, result: r }; };
H['job.save'] = (s, ctx, p, a) => {
  requireGM(a);
  const prev = p.id ? s.jobs[p.id] : null;
  const j = prev ? { ...prev } : crafting.newJob(ctx, p);
  if (prev) {
    for (const k of ['title', 'employer', 'description', 'gmNotes']) if (p[k] !== undefined) j[k] = str(p[k], k === 'description' || k === 'gmNotes' ? 20000 : 120);
    if (p.objectives) j.objectives = p.objectives.map(o => ({ text: str(o.text, 300), done: !!o.done }));
    if (p.assigned) j.assigned = p.assigned.filter(id => s.characters[id]);
    if (p.status && ['open', 'active', 'completed', 'failed'].includes(p.status)) j.status = p.status;
    if (p.reward && !j.paid) j.reward = { money: Math.max(0, Math.floor(Number(p.reward.money) || 0)), split: p.reward.split === 'split' ? 'split' : 'each', items: (p.reward.items || []).filter(x => s.defs[x.defId]) };
    if (p.visible !== undefined) j.visible = !!p.visible;
  }
  s.jobs[j.id] = j;
  return { summary: `Saved job ${j.title}`, gmOnly: !j.visible, result: { id: j.id } };
};
H['job.delete'] = (s, ctx, p, a) => { requireGM(a); delete s.jobs[p.id]; return { summary: 'Deleted job', gmOnly: true }; };
H['job.pay'] = (s, ctx, p, a) => { requireGM(a); const pays = crafting.payJob(s, ctx, p.id); return { summary: `Paid job "${s.jobs[p.id].title}": ${pays.map(x => `${charName(s, x.charId)} +${x.money} ₽`).join(', ')}` }; };

/* ---------- NPCs */
H['npc.generate'] = (s, ctx, p, a) => {
  requireGM(a);
  const r = npcs.generate(s, ctx, p);
  if (p.encounterId) { const e = combat.getEncounter(s, p.encounterId); for (const n of r.npcs) combat.addCombatant(s, e, n.id); }
  return { summary: `Generated ${r.npcs.length} × ${s.npcTemplates[p.templateId].name}${r.warnings.length ? ` (${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''})` : ''}`, gmOnly: true, result: { ids: r.npcs.map(n => n.id), warnings: r.warnings } };
};
H['npc.duplicate'] = (s, ctx, p, a) => { requireGM(a); const c = npcs.duplicate(s, ctx, p.id); return { summary: `Duplicated NPC as ${c.name}`, gmOnly: true, result: { id: c.id } }; };
H['npc.resetVitals'] = (s, ctx, p, a) => { requireGM(a); const c = s.characters[p.id]; assert(c, 'Not found.'); c.session.hp = c.build.hp ?? 10; c.session.fp = c.build.fp ?? 10; c.session.conditions = []; c.session.injuries = []; return { summary: `Reset HP/FP and conditions of ${c.name}`, gmOnly: c.kind === 'npc' }; };
H['template.save'] = (s, ctx, p, a) => { requireGM(a); const id = p.id || ctx.uid('tpl_'); const prev = s.npcTemplates[id] || {}; s.npcTemplates[id] = { ...prev, ...p.template, id }; return { summary: `Saved NPC template ${s.npcTemplates[id].name}`, gmOnly: true, result: { id } }; };
H['template.delete'] = (s, ctx, p, a) => { requireGM(a); delete s.npcTemplates[p.id]; return { summary: 'Deleted NPC template', gmOnly: true }; };
H['template.fromCharacter'] = (s, ctx, p, a) => {
  requireGM(a); const c = s.characters[p.id]; assert(c, 'Not found.');
  const id = ctx.uid('tpl_');
  const loadout = inv.childrenOf(s, 'char:' + c.id).filter(i => i.loc.slot).map(i => ({ slot: i.loc.slot, options: [i.defId], mags: [1, 3] }));
  s.npcTemplates[id] = { id, name: c.name.replace(/\s+\d+$/, ''), archetype: c.archetype || 'Human', faction: c.faction, rank: c.rank, quality: 'standard', build: JSON.parse(JSON.stringify({ ...c.build, source: 'template', portrait: undefined })), loadout, loot: [], money: [0, 0], portrait: c.portrait };
  return { summary: `Created NPC template from ${c.name}`, gmOnly: true, result: { id } };
};

/* ---------- encounters */
H['enc.create'] = (s, ctx, p, a) => { requireGM(a); const e = combat.createEncounter(s, ctx, p); return { summary: `Created encounter ${e.name}`, gmOnly: true, result: { id: e.id } }; };
H['enc.update'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); if (p.name !== undefined) e.name = str(p.name, 120); if (p.env) e.env = { ...e.env, ...p.env }; if (Array.isArray(p.order)) { assert(p.order.length === e.order.length && p.order.every(x => e.combatants[x]), 'Invalid turn order.'); e.order = p.order; } if (p.turn !== undefined) e.turn = Math.max(0, Math.min(e.order.length - 1, Math.floor(p.turn))); return { summary: `Updated encounter ${e.name}`, gmOnly: true }; };
H['enc.addCombatant'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); for (const cid of [].concat(p.charIds || p.charId)) combat.addCombatant(s, e, cid, p.side); return { summary: `Added ${[].concat(p.charIds || p.charId).map(i => charName(s, i)).join(', ')} to ${e.name}`, gmOnly: true }; };
H['enc.removeCombatant'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); combat.removeCombatant(s, e, p.charId); return { summary: `Removed ${charName(s, p.charId)} from ${e.name}`, gmOnly: true }; };
H['enc.start'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); combat.startEncounter(s, e); return { summary: `Encounter ${e.name} started (round ${e.round})` }; };
H['enc.next'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); const r = combat.nextTurn(s, e); return { summary: `Round ${r.round}: ${charName(s, r.actorId)}'s turn`, quiet: true }; };
H['enc.end'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); combat.endEncounter(s, ctx, e); return { summary: `Encounter ${e.name} ended` }; };
H['enc.archive'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); e.status = p.restore ? 'ended' : 'archived'; return { summary: `${p.restore ? 'Restored' : 'Archived'} encounter ${e.name}`, gmOnly: true }; };
H['enc.distance'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); combat.setDistance(e, p.a, p.b, p.yards); return { summary: `Distance ${charName(s, p.a)} ↔ ${charName(s, p.b)}: ${p.yards} yd`, gmOnly: true, quiet: true }; };
H['enc.combatant'] = (s, ctx, p, a) => {
  const e = combat.getEncounter(s, p.id); const cs = e.combatants[p.charId]; assert(cs, 'Not in encounter.');
  if (!isGM(a)) { requireOwn(s, a, p.charId); for (const k of Object.keys(p)) if (!['id', 'charId', 'posture', 'targetId'].includes(k)) throw new PermissionError('Only the GM can change that.'); }
  const rules = require('./rules');
  if (p.posture && rules.POSTURES[p.posture]) { cs.posture = p.posture; s.characters[p.charId].session.posture = p.posture; }
  if (p.cover !== undefined) { assert(rules.COVER[p.cover], 'Unknown cover.'); cs.cover = p.cover; }
  if (p.sm !== undefined) cs.sm = Number(p.sm) || 0;
  if (p.speed !== undefined) cs.speed = Math.max(0, Number(p.speed) || 0);
  if (p.side !== undefined) cs.side = str(p.side, 40);
  if (p.targetId !== undefined) cs.targetId = p.targetId;
  if (p.tempMod) cs.tempMods.push({ id: ctx.uid('tm_'), label: str(p.tempMod.label, 60), value: Number(p.tempMod.value) || 0, expiresRound: p.tempMod.rounds ? e.round + Number(p.tempMod.rounds) : null });
  if (p.removeTempMod) cs.tempMods = cs.tempMods.filter(m => m.id !== p.removeTempMod);
  if (p.clearAim) cs.aim = null;
  return { summary: `Updated ${charName(s, p.charId)} in ${e.name}`, gmOnly: true, quiet: true };
};
H['enc.releaseLoot'] = (s, ctx, p, a) => { requireGM(a); const e = combat.getEncounter(s, p.id); const c = s.characters[p.charId]; assert(c?.kind === 'npc', 'Choose an NPC.'); e.lootReleased = e.lootReleased || []; if (p.release === false) e.lootReleased = e.lootReleased.filter(x => x !== c.id); else if (!e.lootReleased.includes(c.id)) e.lootReleased.push(c.id); if (p.release !== false) c.hidden = false; return { summary: `${p.release === false ? 'Locked' : 'Released'} loot of ${c.name}` }; };
H['npc.reveal'] = (s, ctx, p, a) => { requireGM(a); const c = s.characters[p.id]; assert(c?.kind === 'npc', 'Choose an NPC.'); c.hidden = !p.reveal; return { summary: `${p.reveal ? 'Revealed' : 'Hid'} ${c.name}`, gmOnly: !p.reveal }; };

/* ---------- combat */
function canActFor(s, a, charId) { const c = s.characters[charId]; assert(c, 'Character not found.'); if (c.kind === 'npc') requireGM(a); else requireOwn(s, a, charId); return c; }

H['combat.maneuver'] = (s, ctx, p, a) => { canActFor(s, a, p.charId); const e = combat.getEncounter(s, p.id); combat.setManeuver(s, e, p.charId, p); const m = require('./rules').MANEUVERS[p.maneuver]; const cs = e.combatants[p.charId]; return { summary: `${charName(s, p.charId)}: ${m.label}${p.maneuver === 'aim' ? ` (${cs.aim.turns} turn${cs.aim.turns > 1 ? 's' : ''})` : ''}${p.weaponId && s.items[p.weaponId] ? ` — ${inv.itemName(s, s.items[p.weaponId])}` : ''}`, gmOnly: s.characters[p.charId].kind === 'npc' }; };
H['combat.attack'] = (s, ctx, p, a, env) => {
  const c = canActFor(s, a, p.actorId);
  if (!isGM(a)) { for (const k of ['targetUnaware', 'aimTurns']) if (p[k] !== undefined) throw new PermissionError('Only the GM can set that.'); }
  const ev = combat.declareAttack(s, ctx, { ...p, byUser: a.playerId || 'GM', visibility: isGM(a) ? (p.visibility || (c.kind === 'npc' ? 'public' : 'public')) : 'public' }, s.settings);
  return { summary: `${ev.title}: ${ev.attack.roll.total} vs ${ev.attack.effective} — ${ev.attack.roll.label}`, eventId: ev.id, gmOnly: ev.visibility === 'gm', result: { eventId: ev.id } };
};
H['combat.defend'] = (s, ctx, p, a) => {
  const ev = combat.getEvent(s, p.eventId);
  const target = s.characters[ev.targetId];
  if (!isGM(a)) { requireOwn(s, a, target.id); delete p.base; } else p.byGM = true;
  combat.resolveDefense(s, ctx, ev.id, { ...p, byUser: a.playerId || 'GM' }, s.settings);
  return { summary: `${target.name} ${ev.defense.type === 'none' ? 'does not defend' : `${ev.defense.label}: ${ev.defense.roll.total} vs ${ev.defense.effective} — ${ev.defense.roll.label}`}`, eventId: ev.id, gmOnly: target.kind === 'npc' };
};
H['combat.apply'] = (s, ctx, p, a) => {
  requireGM(a);
  const ev = combat.getEvent(s, p.eventId);
  const pp = { ...p };
  if (ev.kind === 'use' && pp.mode === 'calculated') { pp.mode = 'custom'; pp.hp = ev.proposal.hp; pp.fp = ev.proposal.fp; }
  const app = combat.applyEvent(s, ctx, ev.id, pp, 'GM');
  if (ev.kind === 'use' && ev.proposal?.removeConditions?.length) removeConds(s, app, ev);
  const t = s.characters[app.targetId];
  return { summary: `GM applied ${app.hp > 0 ? '+' : ''}${app.hp} HP${app.fp ? `, ${app.fp} FP` : ''} to ${t.name}${p.mode === 'custom' ? ' (custom amount)' : ''}`, eventId: ev.id, gmOnly: t.kind === 'npc', override: p.mode === 'custom' };
};
function removeConds(s, app, ev) { const t = s.characters[app.targetId]; const rm = ev.proposal.removeConditions.filter(c => t.session.conditions.includes(c)); t.session.conditions = t.session.conditions.filter(c => !rm.includes(c)); app.conditionsRemoved = rm; }
H['combat.applySelf'] = (s, ctx, p, a) => {
  // A player applies healing from their own consumable event to their own character.
  const ev = combat.getEvent(s, p.eventId);
  assert(ev.kind === 'use', 'Only item use results can be self-applied. Wait for the GM.');
  requireOwn(s, a, ev.proposal.targetId);
  const app = combat.applyEvent(s, ctx, ev.id, { mode: 'custom', hp: ev.proposal.hp, fp: ev.proposal.fp }, a.playerId || 'GM');
  if (ev.proposal.removeConditions?.length) removeConds(s, app, ev);
  return { summary: `${charName(s, app.targetId)} applied ${ev.title}: +${app.hp} HP`, eventId: ev.id };
};
H['combat.ignore'] = (s, ctx, p, a) => { requireGM(a); const ev = combat.ignoreEvent(s, p.eventId); return { summary: `GM ignored: ${ev.title}`, eventId: ev.id, gmOnly: true, override: true }; };
H['combat.undo'] = (s, ctx, p, a) => { requireGM(a); const app = combat.undoApplication(s, ctx, p.eventId, p.appId); return { summary: `GM undid ${app.hp > 0 ? '+' : ''}${app.hp} HP on ${charName(s, app.targetId)}`, eventId: p.eventId, override: true }; };
H['combat.close'] = (s, ctx, p, a) => { requireGM(a); combat.closeEvent(s, p.eventId); return { summary: 'Marked resolved', eventId: p.eventId, gmOnly: true, quiet: true }; };
H['combat.notify'] = (s, ctx, p, a) => { requireGM(a); const n = combat.notifyTarget(s, ctx, p.eventId, p); return { summary: `GM told ${charName(s, n.to)}: ${n.text}`, eventId: p.eventId }; };
H['combat.ackNotification'] = (s, ctx, p, a) => { const ev = combat.getEvent(s, p.eventId); const n = ev.notifications.find(x => x.id === p.notifId); assert(n, 'Notification not found.'); requireOwn(s, a, n.to); const app = combat.applyNotification(s, ctx, ev.id, n.id, a.playerId || 'GM'); return { summary: `${charName(s, n.to)} applied ${app.hp} HP as instructed by the GM`, eventId: ev.id }; };
H['combat.override'] = (s, ctx, p, a) => { requireGM(a); const ev = combat.getEvent(s, p.eventId); const before = JSON.stringify(ev.overrides.length); combat.overrideEvent(s, ctx, ev.id, p, 'GM', s.settings); return { summary: `GM override on "${ev.title}": ${p.field} → ${p.value}${before ? '' : ''}`, eventId: ev.id, gmOnly: true, override: true }; };
H['combat.followUp'] = (s, ctx, p, a) => { requireGM(a); const f = combat.rollFollowUp(s, ctx, p.eventId, p); return { summary: `${f.label}: ${f.result.roll.total} vs ${f.result.effective} — ${f.result.roll.label}`, eventId: p.eventId, gmOnly: true }; };

/* ---------- rolls */
H['roll.skill'] = (s, ctx, p, a) => {
  const c = canActFor(s, a, p.actorId);
  if (!isGM(a)) delete p.baseOverride;
  let visibility = p.visibility || 'public';
  if (p.requestEventId) { const req = s.events[p.requestEventId]; assert(req && req.kind === 'request' && req.actorId === c.id && req.stage === 'pending', 'That roll request is no longer open.'); visibility = req.requestVisibility; p.mods = (req.mods || []).concat(p.mods || []); }
  if (!isGM(a) && visibility === 'hidden' && !p.requestEventId) visibility = 'public';
  const ev = combat.rollSkill(s, ctx, { ...p, visibility, byGM: isGM(a), byUser: a.playerId || 'GM' });
  return { summary: `${ev.title}: ${ev.roll.total} vs ${ev.effective} — ${ev.roll.label}`, eventId: ev.id, gmOnly: visibility !== 'public', result: { eventId: ev.id } };
};
H['roll.request'] = (s, ctx, p, a) => { requireGM(a); const ev = combat.requestRoll(s, ctx, p); return { summary: ev.title, eventId: ev.id, result: { eventId: ev.id } }; };
H['roll.contest'] = (s, ctx, p, a) => { requireGM(a); const ev = combat.rollContest(s, ctx, p); return { summary: `${ev.title}: ${ev.status}`, eventId: ev.id, gmOnly: ev.visibility !== 'public' }; };
H['roll.free'] = (s, ctx, p, a) => { if (p.actorId) canActFor(s, a, p.actorId); else requireGM(a); const ev = combat.rollFree(s, ctx, { ...p, visibility: isGM(a) ? (p.visibility || 'gm') : 'public' }); return { summary: `${ev.title}: ${ev.free.dice.join('+')}${ev.free.add ? (ev.free.add > 0 ? '+' : '') + ev.free.add : ''} = ${ev.free.total}`, eventId: ev.id, gmOnly: ev.visibility !== 'public' }; };

/* ---------- Tabletop Simulator */
H['tts.link'] = (s, ctx, p, a) => { requireGM(a); assert(s.characters[p.charId], 'Character not found.'); assert(/^[A-Za-z0-9]{1,12}$/.test(p.guid || ''), 'Invalid TTS object GUID.'); for (const [g, id] of Object.entries(s.tts.links)) if (id === p.charId) delete s.tts.links[g]; s.tts.links[p.guid] = p.charId; return { summary: `Linked TTS token ${p.guid} to ${charName(s, p.charId)}`, gmOnly: true, quiet: true }; };
H['tts.unlink'] = (s, ctx, p, a) => { requireGM(a); delete s.tts.links[p.guid]; return { summary: `Unlinked TTS token ${p.guid}`, gmOnly: true, quiet: true }; };

/* ==================================================================== engine */

class Engine {
  /**
   * @param {object} state campaign state (will be migrated)
   * @param {object} [hooks] { journal(entry), changed(info) }
   */
  constructor(state, hooks = {}) {
    this.state = state;
    campaign.migrate(this.state);
    this.hooks = hooks;
    this.contextFactory = hooks.contextFactory || (opts => new Context(opts));
  }

  static actions() { return Object.keys(H); }

  /**
   * Run an action. Returns { ok, result, summary, eventId, duplicate? } or throws ActionError.
   */
  dispatch(action, payload = {}, actor = { role: 'gm' }, opts = {}) {
    const handler = H[action];
    if (!handler) throw new ActionError(`Unknown action "${action}".`);
    const s0 = this.state;
    const reqKey = opts.requestId ? `${actor.role}:${actor.playerId || ''}:${opts.requestId}` : null;
    if (reqKey && s0.meta.processed[reqKey]) return { ...s0.meta.processed[reqKey], duplicate: true };
    const draft = structuredClone(s0);
    const ctx = this.contextFactory(opts.replay ? { replay: opts.replay } : {});
    const out = handler(draft, ctx, structuredClone(payload || {}), actor, this) || {};
    draft.meta.seq = (draft.meta.seq || 0) + 1;
    if (!out.quiet || isGM(actor) === false) audit(draft, ctx, actor, action, out.summary || action, out);
    const response = { ok: true, result: out.result ?? null, summary: out.summary || '', eventId: out.eventId || null, seq: draft.meta.seq };
    if (reqKey) {
      draft.meta.processed[reqKey] = { ...response, at: Date.now() };
      const keys = Object.keys(draft.meta.processed);
      if (keys.length > MAX_PROCESSED) for (const k of keys.slice(0, keys.length - MAX_PROCESSED)) delete draft.meta.processed[k];
    }
    this.state = draft;
    if (this.hooks.journal && !opts.replay) this.hooks.journal({ seq: draft.meta.seq, action, payload, actor, requestId: opts.requestId || null, tape: ctx.tape, at: new Date().toISOString() });
    if (this.hooks.changed) this.hooks.changed({ action, actor, response });
    return response;
  }

  /** Re-apply a journal entry during crash recovery. */
  replay(entry) {
    return this.dispatch(entry.action, entry.payload, entry.actor, { requestId: entry.requestId, replay: entry.tape });
  }
}

module.exports = { Engine, ownsChar, canUseRef, isGM, handlers: H };
