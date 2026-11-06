'use strict';
/**
 * Per-viewer projections of the campaign. The GM receives everything; players receive only
 * what they are allowed to see. This is the data boundary — hidden NPC statistics, GM notes,
 * GM-only rolls, concealed target numbers and unapproved results never leave the host.
 */
const inv = require('./inventory');
const chars = require('./characters');
const weapons = require('./weapons');
const traders = require('./traders');
const crafting = require('./crafting');
const rules = require('./rules');
const { canUseRef, ownsChar } = require('./engine');

/** Derived data for a character (used by both GM and player views). */
function enrichCharacter(s, c) {
  const d = chars.derived(s, c);
  return { ...c, derived: { dodge: d.dodge, move: d.move, encumbrance: d.encumbrance.name, encLevel: d.encumbrance.level, carriedKg: Math.round(d.carriedKg * 100) / 100, basicLiftKg: Math.round(d.encumbrance.basicLift / rules.KG_TO_LB * 100) / 100, thrust: d.thrust, swing: d.swing, state: d.state, notes: d.notes } };
}

function itemExtras(s, it) {
  const d = s.defs[it.defId];
  const x = {};
  if (d?.weapon) { try { const st = weapons.effectiveStats(s, it); x.stats = { acc: st.acc, rcl: st.rcl, bulk: st.bulk, scope: st.scope, breakdown: st.breakdown }; x.feed = { kind: st.feed.kind, rounds: st.feed.rounds, capacity: st.feed.capacity, chamber: st.feed.chamber, magazineId: st.feed.magazine?.id || null }; } catch { /* ignore */ } }
  if (d?.magazine || d?.weapon?.integral) x.roundCount = weapons.roundCount(it.rounds);
  x.weight = Math.round(inv.weightOf(s, it) * 1000) / 1000;
  return x;
}

function withExtras(s, items) {
  const out = {};
  for (const it of items) out[it.id] = { ...it, ...itemExtras(s, it) };
  return out;
}

function gmView(s) {
  const characters = {};
  for (const c of Object.values(s.characters)) characters[c.id] = enrichCharacter(s, c);
  const traderPrices = {};
  for (const t of Object.values(s.traders)) for (const it of inv.childrenOf(s, 'trader:' + t.id)) traderPrices[it.id] = traders.buyPrice(s, t, it);
  const recipeStatus = {};
  return {
    role: 'gm', name: s.name, id: s.id, test: !!s.test, notes: s.notes, gmNotes: s.gmNotes, settings: s.settings,
    players: Object.fromEntries(Object.values(s.players).map(p => [p.id, { id: p.id, name: p.name, color: p.color, hasCode: !!p.codeHash }])),
    defs: s.defs, items: withExtras(s, Object.values(s.items)), characters, stashes: s.stashes, traders: s.traders, traderPrices,
    encounters: s.encounters, events: s.events, npcTemplates: s.npcTemplates, recipes: s.recipes, recipeStatus, jobs: s.jobs, perks: s.perks, perkRequests: s.perkRequests,
    assets: s.assets, ledger: s.ledger.slice(-500), log: s.log.slice(0, 600), trash: s.trash.map(t => ({ id: t.id, at: t.at, kind: t.kind, name: t.character?.name || `${t.items.length} item(s)` })), tts: s.tts, seq: s.meta.seq,
  };
}

const DESCRIPTIVE = { healthy: 'Unhurt', wounded: 'Wounded', reeling: 'Badly wounded', critical: 'Collapsing', unconscious: 'Down', dead: 'Dead' };

function publicNpc(s, c, mode, lootable) {
  const d = chars.derived(s, c);
  const out = { id: c.id, kind: 'npc', name: c.reveal?.name === false ? 'Unknown' : c.name, faction: c.faction, portrait: c.portrait, lootable, session: { conditions: c.session.conditions.filter(x => ['Dead', 'Unconscious', 'Knocked Down', 'Stunned', 'On Fire'].includes(x)), posture: c.session.posture } };
  if (mode === 'exact' || c.reveal?.status) { out.session.hp = c.session.hp; out.build = { hp: c.build.hp, fp: c.build.fp }; out.session.fp = c.session.fp; }
  if (mode !== 'none') out.status = DESCRIPTIVE[d.state] || '';
  return out;
}

function publicPc(s, c) {
  return { id: c.id, kind: 'pc', name: c.name, nickname: c.nickname, faction: c.faction, rank: c.rank, portrait: c.portrait, ownerId: c.ownerId, session: { hp: c.session.hp, fp: c.session.fp, conditions: c.session.conditions, posture: c.session.posture }, build: { hp: c.build.hp, fp: c.build.fp } };
}

/** Redact an event for a player. Returns null if the player may not see it. */
function eventForPlayer(s, ev, myChars) {
  const mineActor = myChars.has(ev.actorId);
  const mineTarget = myChars.has(ev.targetId) || ev.notifications?.some(n => myChars.has(n.to));
  if (ev.kind === 'request') return mineActor ? { ...ev } : null;
  if (ev.visibility === 'gm') return mineActor ? { id: ev.id, seq: ev.seq, at: ev.at, kind: ev.kind, actorId: ev.actorId, title: ev.title, secret: true, stage: 'secret', status: 'Secret roll sent to the GM' } : null;
  const enc = ev.encounterId ? s.encounters[ev.encounterId] : null;
  const inEncounter = enc && [...myChars].some(id => enc.combatants[id]);
  if (!mineActor && !mineTarget && !inEncounter && ev.kind !== 'skill' && ev.kind !== 'roll') return null;
  const actor = s.characters[ev.actorId];
  const target = s.characters[ev.targetId];
  const npcActor = actor?.kind === 'npc', npcTarget = target?.kind === 'npc';
  if (npcActor && actor.hidden && !mineTarget) return null;
  let title = ev.title;
  for (const c of [actor, target]) if (c?.kind === 'npc' && c.reveal?.name === false) title = title.split(c.name).join('Unknown');
  const out = { id: ev.id, seq: ev.seq, at: ev.at, round: ev.round, kind: ev.kind, actorId: ev.actorId, targetId: ev.targetId, encounterId: ev.encounterId, title, stage: ev.stage, visibility: ev.visibility };
  out.notifications = (ev.notifications || []).filter(n => myChars.has(n.to));
  if (ev.kind === 'skill') {
    if (!mineActor && actor?.kind === 'npc') return null;
    out.skill = ev.skill; out.note = ev.note;
    if (ev.visibility === 'hidden') { out.roll = { dice: ev.roll.dice, total: ev.roll.total }; out.status = 'Rolled — the GM knows the result'; }
    else { out.baseSkill = ev.baseSkill; out.baseExplain = ev.baseExplain; out.mods = ev.mods; out.effective = ev.effective; out.roll = ev.roll; out.status = ev.status; }
    return out;
  }
  if (ev.kind === 'attack') {
    const a = ev.attack;
    if (mineActor) out.attack = { weapon: { name: a.weapon.name, kind: a.weapon.kind }, baseSkill: a.baseSkill, baseSkillExplain: a.baseSkillExplain, mods: a.mods, effective: a.effective, roll: a.roll, shots: a.shots, hits: a.hits, crit: a.crit, range: a.range, hitLocation: a.hitLocation, ammo: a.ammo };
    else out.attack = { weapon: { name: a.weapon.name, kind: a.weapon.kind }, roll: { success: a.roll.success, critical: a.roll.critical, label: a.roll.success ? 'Hit attempt succeeded' : 'Missed' }, shots: a.shots, hits: npcActor ? undefined : a.hits };
    if (ev.defense) out.defense = npcTarget && !mineTarget ? { type: ev.defense.type, label: ev.defense.label, success: ev.defense.roll?.success ?? false, hitsDefended: ev.defense.hitsDefended } : { ...ev.defense };
    if (ev.stage === 'awaiting-defense' && mineTarget) out.defenseOptions = ev.defenseOptions;
    if (ev.damage) {
      if (mineTarget && !npcTarget) out.damage = { hits: ev.damage.hits.map(h => ({ location: h.location, basic: h.basic, dr: h.dr, injury: h.injury })), totalInjury: ev.damage.totalInjury };
      else if (mineActor) out.damage = { hits: ev.damage.hits.map(h => ({ location: h.location, dice: h.dice, basic: h.basic, damageText: h.damageText })) };
    }
    const applied = ev.applications?.find(x => !x.undone);
    if (ev.stage === 'applied' && applied && (s.settings.rules.showDamageToPlayers || !npcTarget)) out.applied = { hp: applied.hp, fp: applied.fp };
    out.status = ev.stage === 'awaiting-defense' ? (mineTarget ? 'Incoming attack — roll your defense' : 'Awaiting defense') : ev.stage === 'applied' ? 'Resolved by the GM' : ev.stage === 'ignored' ? 'Resolved by the GM' : ev.attack.roll.success ? 'Awaiting GM decision' : 'Missed';
    if (npcTarget && ev.defense && !mineTarget) out.status = ev.attack.hitsAfterDefense === 0 ? 'The target avoided the attack' : out.status;
    return out;
  }
  if (ev.kind === 'use') { out.use = ev.use; out.proposal = mineActor || mineTarget ? ev.proposal : undefined; out.applications = ev.applications; out.status = ev.status; return out; }
  if (ev.kind === 'adjust') { if (npcTarget) return null; out.status = ev.status; out.reason = ev.reason; return out; }
  if (ev.kind === 'roll') { if (!mineActor) return null; out.free = ev.free; out.status = ev.status; return out; }
  if (ev.kind === 'contest') return null;
  out.status = ev.status;
  return out;
}

function playerView(s, playerId) {
  const actor = { role: 'player', playerId };
  const myChars = new Set(Object.values(s.characters).filter(c => ownsChar(s, actor, c.id)).map(c => c.id));
  const mode = s.settings.rules.npcStatusToPlayers;
  const activeEncs = Object.values(s.encounters).filter(e => (e.status === 'active' || e.status === 'paused' || e.status === 'planning') && [...myChars].some(id => e.combatants[id]));
  const released = new Set(Object.values(s.encounters).flatMap(e => e.lootReleased || []));
  const characters = {};
  for (const c of Object.values(s.characters)) {
    if (c.archived && !myChars.has(c.id)) continue;
    if (myChars.has(c.id)) { const full = enrichCharacter(s, c); delete full.gmNotes; full.mine = true; characters[c.id] = full; }
    else if (c.kind === 'pc') characters[c.id] = publicPc(s, c);
    else if (!c.hidden && (released.has(c.id) || activeEncs.some(e => e.combatants[c.id]))) characters[c.id] = publicNpc(s, c, mode, released.has(c.id));
  }
  // Items: own characters, accessible stashes, released loot (not GM-hidden), open trader stock.
  const visibleRoots = new Set([...myChars].map(id => 'char:' + id));
  const stashes = {};
  for (const st of Object.values(s.stashes)) if (canUseRef(s, actor, 'stash:' + st.id, 'take')) { visibleRoots.add('stash:' + st.id); stashes[st.id] = { id: st.id, name: st.name, grid: st.grid, ownerCharId: st.ownerCharId || null }; }
  for (const id of released) if (s.characters[id] && !s.characters[id].hidden) visibleRoots.add('char:' + id);
  const tradersOut = {};
  const traderPrices = {};
  for (const t of Object.values(s.traders)) {
    if (![...myChars].some(id => traders.shopOpenFor(t, id))) continue;
    visibleRoots.add('trader:' + t.id);
    tradersOut[t.id] = { id: t.id, name: t.name, type: t.type, tier: t.tier, grid: t.grid, open: true, sellMult: t.sellMult, buyMult: t.buyMult, portrait: t.portrait, openFor: t.openFor.filter(x => myChars.has(x)) };
    for (const it of inv.childrenOf(s, 'trader:' + t.id)) traderPrices[it.id] = traders.buyPrice(s, t, it);
  }
  const items = [];
  for (const it of Object.values(s.items)) {
    const root = inv.rootOf(s, it);
    if (!visibleRoots.has(root)) continue;
    if (it.hidden && !myChars.has(root.slice(5))) continue;
    items.push({ ...it });
  }
  // definitions: everything except GM-only definitions, unless the player holds one
  const heldDefs = new Set(items.map(i => i.defId));
  for (const it of items) for (const [a] of it.rounds || []) heldDefs.add(a);
  const defs = {};
  for (const d of Object.values(s.defs)) if (!d.tags.includes('gm-only') || heldDefs.has(d.id)) defs[d.id] = d;
  const events = {};
  for (const ev of Object.values(s.events)) { const e = eventForPlayer(s, ev, myChars); if (e) events[e.id] = e; }
  const encounters = {};
  for (const e of activeEncs) {
    const order = e.order.filter(id => characters[id]);
    const combatants = {};
    for (const id of order) { const cs = e.combatants[id]; combatants[id] = myChars.has(id) ? cs : { charId: id, side: cs.side, posture: cs.posture, maneuver: s.characters[id]?.kind === 'pc' ? cs.maneuver : undefined }; }
    const distances = {};
    for (const [k, v] of Object.entries(e.distances)) { const [a, b] = k.split('|'); if ((myChars.has(a) && characters[b]) || (myChars.has(b) && characters[a])) distances[k] = v; }
    encounters[e.id] = { id: e.id, name: e.name, status: e.status, round: e.round, turn: e.order[e.turn] && characters[e.order[e.turn]] ? order.indexOf(e.order[e.turn]) : -1, order, combatants, distances, env: { darkness: e.env.darkness }, lootReleased: (e.lootReleased || []).filter(id => characters[id]) };
  }
  const recipeStatus = {};
  if (s.settings.rules.crafting) for (const r of Object.values(s.recipes)) if (r.enabled !== false) for (const id of myChars) recipeStatus[`${r.id}:${id}`] = crafting.recipeStatus(s, id, r);
  const jobs = {};
  for (const j of Object.values(s.jobs)) if (j.visible || j.assigned.some(id => myChars.has(id))) { const c = { ...j }; delete c.gmNotes; jobs[j.id] = c; }
  const assets = {};
  const usedAssets = new Set([...Object.values(defs).flatMap(d => [d.image, d.attachment?.art?.image]), ...Object.values(characters).map(c => c.portrait)].filter(Boolean));
  for (const id of usedAssets) if (s.assets[id]) assets[id] = s.assets[id];
  return {
    role: 'player', playerId, playerName: s.players[playerId]?.name || 'Player', name: s.name, id: s.id, test: !!s.test,
    settings: { rules: { crafting: s.settings.rules.crafting, playerSelfAdjust: s.settings.rules.playerSelfAdjust, ammoEffects: s.settings.rules.ammoEffects }, economy: { currency: s.settings.economy.currency }, ranks: s.settings.ranks.map(r => ({ name: r.name })), perkPerRank: s.settings.perkPerRank },
    players: Object.fromEntries(Object.values(s.players).map(p => [p.id, { id: p.id, name: p.name, color: p.color }])),
    defs, items: withExtras(s, items), characters, stashes, traders: tradersOut, traderPrices, encounters, events,
    recipes: s.settings.rules.crafting ? Object.fromEntries(Object.values(s.recipes).filter(r => r.enabled !== false).map(r => [r.id, r])) : {}, recipeStatus, jobs,
    perks: s.perks, perkRequests: s.perkRequests.filter(r => myChars.has(r.charId)), assets,
    log: s.log.filter(l => !l.gmOnly && (l.playerId === playerId || l.role === 'gm')).slice(0, 200).map(l => ({ id: l.id, at: l.at, who: l.who, summary: l.summary })),
    seq: s.meta.seq,
  };
}

function viewFor(s, actor) { return actor.role === 'gm' ? gmView(s) : playerView(s, actor.playerId); }

module.exports = { viewFor, gmView, playerView, eventForPlayer, enrichCharacter };
