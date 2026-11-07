// Attack and skill-roll forms shared by players (their PCs) and the GM (NPCs), plus the
// player's combat page.
import { html, useState, run, Panel, Bar, signed, tipProps, askNumber, money, useLocal } from './ui.js';
import * as M from './model.js';
import { EventFeed } from './events.js';

const QUICK_MODS = [-4, -2, -1, +1, +2, +4];

export function weaponOptions(v, c) {
  const out = [];
  const carried = M.owned(v, c.id).filter(i => M.def(v, i)?.weapon && i.loc.mount === undefined && !(i.loc.g === 'ground'));
  const order = { ready: -1, primary: 0, secondary: 1, holster: 2, melee: 3 };
  carried.sort((a, b) => (order[a.loc.slot] ?? 9) - (order[b.loc.slot] ?? 9));
  for (const w of carried) {
    const d = M.def(v, w);
    out.push({ key: 'item:' + w.id, ref: { itemId: w.id }, label: `${w.loc.slot === 'ready' ? '✋ ' : ''}${M.itemName(v, w)}${w.loc.slot === 'ready' ? (w.readyAt ? ` (${w.busy || 'readying'} → R${w.readyAt})` : ' (in hands)') : w.loc.slot ? ' (slung)' : ' (stowed)'}${d.weapon.kind === 'ranged' ? ` · ${w.feed?.rounds ?? 0} rds` : ''}`, kind: d.weapon.kind, rof: d.weapon.rof, rounds: w.feed?.rounds ?? 0, item: w, def: d });
  }
  (c.build?.weapons || []).forEach((w, i) => out.push({ key: 'gcs:' + (w.id || i), ref: { gcsWeaponId: w.id || String(i) }, label: `${w.owner}${w.usage ? ` (${w.usage})` : ''} · ${w.damage} [sheet]`, kind: w.kind, rof: w.rof || '1', rounds: Infinity, gcs: w }));
  return out;
}

/** Why this attack cannot be made right now (mirrors the host's rules; the host still checks). */
function blockReason(v, enc, actorId, w) {
  if (!enc || enc.status !== 'active') return null;
  if (enc.break) return 'Break in the action — nobody attacks. Use the time to ready, reload or aim.';
  const gm = v.role === 'gm';
  if (!gm && v.settings?.rules?.enforceTurns !== false && enc.order[enc.turn] !== actorId) return `Wait for your turn — it is ${M.charName(v, enc.order[enc.turn])}'s turn.`;
  if (!w?.item) return null;
  if (w.item.readyAt && enc.round < w.item.readyAt) return `${M.itemName(v, w.item)} is ${w.item.busy || 'being readied'} — usable from round ${w.item.readyAt}.`;
  if (v.settings?.rules?.readyRequired !== false && w.item.loc.slot !== 'ready') return `${M.itemName(v, w.item)} is not in your hands. Readying takes this turn (usable next round), or roll Fast-Draw.`;
  return null;
}

/** Attack declaration form. */
export function AttackForm({ v, actorId, compact }) {
  const c = v.characters[actorId];
  const gm = v.role === 'gm';
  const enc = M.activeEncounterFor(v, actorId);
  const cs = enc?.combatants?.[actorId];
  const weapons = c ? weaponOptions(v, c) : [];
  const [wKey, setW] = useState('');
  const [targetId, setTarget] = useState('');
  const [shots, setShots] = useState(1);
  const [loc, setLoc] = useState('torso');
  const [mods, setMods] = useState([]);
  const [range, setRange] = useState('');
  const [unaware, setUnaware] = useState(false);
  const [visibility, setVis] = useState('public');
  const [busy, setBusy] = useState(false);
  if (!c) return html`<div class="empty">Choose a character.</div>`;
  const w = weapons.find(x => x.key === wKey) || weapons.find(x => cs?.readyWeaponId && x.key === 'item:' + cs.readyWeaponId) || weapons[0];
  // default target: the last one chosen, else the nearest living opponent by GM-set distance
  const autoTarget = () => {
    if (!enc) return '';
    const me = c.kind;
    const foes = enc.order.filter(id => id !== actorId && v.characters[id] && (me === 'npc' ? v.characters[id].kind === 'pc' : v.characters[id].kind === 'npc') && !(v.characters[id].session?.conditions || []).includes('Dead'));
    return foes.sort((a, b) => (M.distanceBetween(enc, actorId, a) ?? 1e9) - (M.distanceBetween(enc, actorId, b) ?? 1e9))[0] || '';
  };
  const tId = targetId || cs?.targetId || autoTarget();
  const targets = enc ? enc.order.filter(id => id !== actorId && v.characters[id]) : Object.values(v.characters).filter(x => x.id !== actorId && (gm ? true : x.kind === 'npc')).map(x => x.id);
  const rofN = parseInt(w?.rof, 10) || 1;
  const maxShots = Math.max(1, Math.min(rofN, w?.rounds === Infinity ? rofN : w?.rounds || 1));
  const dist = enc && tId ? M.distanceBetween(enc, actorId, tId) : null;
  const aim = cs?.aim && w?.item && cs.aim.weaponId === w.item.id && cs.aim.targetId === tId ? cs.aim : null;
  const roll = async () => {
    if (!w) return;
    setBusy(true);
    const payload = { actorId, targetId: tId || null, weapon: w.ref, shots: Math.min(shots, maxShots), hitLocation: loc, extraMods: mods, encounterId: enc?.id };
    if (range !== '') payload.range = Number(range);
    if (gm) { payload.targetUnaware = unaware || undefined; payload.visibility = visibility; }
    const r = await run('combat.attack', payload);
    setBusy(false);
    if (r) { setMods([]); }
  };
  return html`<div class="col">
    <div class="form">
      <label class="field wide">Weapon<select value=${w?.key} onChange=${e => setW(e.target.value)}>${weapons.map(o => html`<option value=${o.key}>${o.label}</option>`)}</select></label>
      <label class="field">Target<select value=${tId} onChange=${e => setTarget(e.target.value)}><option value="">— none —</option>${targets.map(id => html`<option value=${id}>${v.characters[id]?.name}${v.characters[id]?.status ? ` (${v.characters[id].status})` : ''}</option>`)}</select></label>
      <label class="field">Hit location<select value=${loc} onChange=${e => setLoc(e.target.value)}>${M.LOCATIONS.map(([k, l, p]) => html`<option value=${k}>${l}${p ? ` (${p})` : ''}</option>`)}</select></label>
      ${w?.kind === 'ranged' ? html`<label class="field">Shots (RoF ${w.rof})<input type="number" min="1" max=${maxShots} value=${Math.min(shots, maxShots)} onInput=${e => setShots(Math.max(1, Math.min(maxShots, Number(e.target.value) || 1)))} /></label>
      <label class="field" ...${tipProps(dist !== null ? `GM-set distance ${dist} yd. Leave blank to use it.` : 'No distance set by the GM. Enter yards, or leave blank (no range penalty will be applied — noted on the roll).')}>Range (yd)<input type="number" min="0" placeholder=${dist !== null ? String(dist) : 'unset'} value=${range} onInput=${e => setRange(e.target.value)} /></label>` : null}
    </div>
    <div class="row small">
      ${aim ? html`<span class="chip good">Aiming ${aim.turns} turn${aim.turns > 1 ? 's' : ''}${aim.braced ? ', braced' : ''}</span>` : html`<span class="chip">Not aiming</span>`}
      ${cs?.shock ? html`<span class="chip bad">Shock ${cs.shock}</span>` : null}
      ${w?.item && cs?.readyWeaponId && cs.readyWeaponId !== w.item.id ? html`<span class="chip warn">Not the readied weapon</span>` : null}
      <span class="muted">Quick modifier:</span>${QUICK_MODS.map(m => html`<button class="small" onClick=${() => setMods([...mods, { label: `Situational ${signed(m)}`, value: m }])}>${signed(m)}</button>`)}
      ${mods.map((m, i) => html`<span class="chip info">${m.label}<button onClick=${() => setMods(mods.filter((_, j) => j !== i))}>✕</button></span>`)}
    </div>
    ${gm ? html`<div class="row small"><label class="row"><input type="checkbox" checked=${unaware} onChange=${e => setUnaware(e.target.checked)} /> Target unaware (no defense)</label>
      <label class="row">Visibility <select value=${visibility} onChange=${e => setVis(e.target.value)}><option value="public">Public</option><option value="gm">GM only</option></select></label></div>` : null}
    ${(() => { const why = blockReason(v, enc, actorId, w); return why ? html`<div class="notice-bar small">${why}${w?.item && w.item.loc.slot !== 'ready' && !enc?.break ? html` <button class="small good" onClick=${() => run('item.ready', { itemId: w.item.id, charId: actorId }, { ok: true })}>✋ Ready it</button> <button class="small" onClick=${() => run('item.ready', { itemId: w.item.id, charId: actorId, fastDraw: true }, { ok: true })}>⚡ Fast-Draw</button>` : null}</div>` : null; })()}
    <div class="row"><button class="primary" disabled=${busy || !w || (w.kind === 'ranged' && !w.rounds) || !!blockReason(v, enc, actorId, w)} onClick=${roll}>🎯 Roll attack${w?.kind === 'ranged' && !w.rounds ? ' (empty)' : ''}</button>
      ${w?.item && w.kind === 'ranged' ? html`<button class=${!w.rounds ? 'good' : ''} onClick=${() => run('weapon.reload', { weaponId: w.item.id }, { ok: true })} title="Insert the fullest magazine you carry, or load loose rounds">↻ Reload</button>` : null}
      ${w?.item && w.kind === 'ranged' && !w.def.weapon.integral ? html`<span class="muted small">${w.item.feed?.chamber ? 'Round chambered' : 'Chamber empty'}</span>` : null}</div>
  </div>`;
}

/** Maneuver selection for the current encounter. */
export function ManeuverBar({ v, actorId }) {
  const enc = M.activeEncounterFor(v, actorId);
  const c = v.characters[actorId];
  const cs = enc?.combatants?.[actorId];
  if (!enc || !c) return html`<div class="muted small">Not in an active encounter.</div>`;
  const weapons = weaponOptions(v, c).filter(o => o.item);
  const ready = weapons.find(o => o.item.id === cs?.readyWeaponId) || weapons[0];
  const set = (maneuver, extra = {}) => run('combat.maneuver', { id: enc.id, charId: actorId, maneuver, weaponId: extra.weaponId ?? ready?.item.id, targetId: extra.targetId ?? cs?.targetId, ...extra });
  return html`<div class="col">
    <div class="row small"><span class="muted">Round ${enc.round} · ${enc.order[enc.turn] === actorId ? html`<span class="turn-marker">your turn</span>` : `turn: ${M.charName(v, enc.order[enc.turn])}`}</span>
      <span class="chip">${cs?.maneuver ? cs.maneuver : 'no maneuver'}</span>
      <label class="row">Posture <select value=${c.session.posture} onChange=${e => run('enc.combatant', { id: enc.id, charId: actorId, posture: e.target.value })}>${M.POSTURES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label></div>
    <div class="row">
      <button onClick=${() => set('aim')} ...${tipProps('Aim (B364): first turn adds the weapon Acc, +1 for a second turn, +2 for three or more. Aim at the selected target with the readied weapon.')}>Aim${cs?.aim ? ` (${cs.aim.turns})` : ''}</button>
      <button onClick=${() => set('aim', { braced: true })}>Aim braced</button>
      <select onChange=${e => { if (e.target.value) set('ready', { weaponId: e.target.value }); e.target.value = ''; }}><option value="">Ready weapon…</option>${weapons.map(o => html`<option value=${o.item.id}>${o.label}</option>`)}</select>
      ${M.MANEUVERS.filter(([k]) => !['aim', 'ready', 'attack'].includes(k)).map(([k, l]) => html`<button class="small" onClick=${() => set(k)}>${l}</button>`)}
    </div></div>`;
}

/** Skill and attribute roller. */
export function SkillRoller({ v, actorId }) {
  const c = v.characters[actorId];
  const gm = v.role === 'gm';
  const [q, setQ] = useState('');
  const [mod, setMod] = useState(0);
  const [vis, setVis] = useState(gm ? 'gm' : 'public');
  if (!c?.build) return null;
  const attrs = [['ST', c.build.st], ['DX', c.build.dx], ['IQ', c.build.iq], ['HT', c.build.ht], ['Will', c.build.will], ['Per', c.build.per]];
  const skills = (c.build.skills || []).filter(s => s.level !== null && `${s.name} ${s.spec}`.toLowerCase().includes(q.toLowerCase()));
  const roll = skill => run('roll.skill', { actorId, skill, mods: mod ? [{ label: 'Modifier', value: mod }] : [], visibility: vis });
  return html`<div class="col">
    <div class="row"><input class="search grow" placeholder="Search skills…" value=${q} onInput=${e => setQ(e.target.value)} />
      <label class="row small">Mod <input type="number" value=${mod} onInput=${e => setMod(Number(e.target.value) || 0)} style=${{ width: '56px' }} /></label>
      ${gm ? html`<select value=${vis} onChange=${e => setVis(e.target.value)}><option value="gm">GM only</option><option value="public">Public</option><option value="hidden">Concealed target</option></select>` : null}</div>
    <div class="row">${attrs.map(([k, val]) => html`<button class="small" onClick=${() => roll(k)}>${k} ${val}</button>`)}</div>
    <div class="scroll h-sm"><table class="t"><tbody>${skills.map(s => html`<tr><td>${s.name}${s.spec ? ` (${s.spec})` : ''}${s.technique ? html` <span class="chip">technique</span>` : ''}</td><td class="mono">${s.level}${s.rsl ? html` <span class="dim">${s.rsl}</span>` : ''}</td><td><button class="small" onClick=${() => roll(s.spec ? `${s.name} (${s.spec})` : s.name)}>Roll${mod ? ` ${signed(mod)}` : ''}</button></td></tr>`)}</tbody></table>
      ${!skills.length ? html`<div class="empty">No matching skills on the sheet. Rolling an unlisted skill uses its default.</div>` : null}</div>
    <div class="row small"><input placeholder="Other skill, e.g. Stealth" onKeyDown=${e => { if (e.key === 'Enter' && e.target.value) roll(e.target.value); }} /><span class="muted">Enter to roll (uses default if not on sheet)</span></div>
  </div>`;
}

export function Vitals({ v, c, compact }) {
  const gm = v.role === 'gm';
  const canAdjust = gm || (c.mine && v.settings?.rules?.playerSelfAdjust !== false);
  const adj = async (pool, sign) => { const n = await askNumber(`${sign < 0 ? 'Reduce' : 'Restore'} ${pool.toUpperCase()}`, { value: 1, min: 1, max: 200 }); if (n) run('char.adjust', { id: c.id, [pool]: sign * n, reason: 'manual' }); };
  return html`<div class="col">
    <div class="row nowrap"><b style=${{ width: '24px' }}>HP</b><div class="grow"><${Bar} cur=${c.session.hp} max=${c.build?.hp ?? '?'} /></div>${canAdjust ? html`<span class="hp-ctl"><button class="small" onClick=${() => adj('hp', -1)}>−</button><button class="small" onClick=${() => adj('hp', 1)}>+</button></span>` : null}</div>
    <div class="row nowrap"><b style=${{ width: '24px' }}>FP</b><div class="grow"><${Bar} cur=${c.session.fp} max=${c.build?.fp ?? '?'} kind="fp" /></div>${canAdjust ? html`<span class="hp-ctl"><button class="small" onClick=${() => adj('fp', -1)}>−</button><button class="small" onClick=${() => adj('fp', 1)}>+</button></span>` : null}</div>
    <div class="row">${(c.session.conditions || []).map(x => html`<span class="chip bad">${x}${canAdjust ? html`<button onClick=${() => run('char.adjust', { id: c.id, conditionsRemove: [x] })}>✕</button>` : null}</span>`)}
      ${canAdjust ? html`<select class="small" value="" onChange=${e => { if (e.target.value) run('char.adjust', { id: c.id, conditionsAdd: [e.target.value] }); e.target.value = ''; }}><option value="">+ condition</option>${M.CONDITIONS.filter(x => !(c.session.conditions || []).includes(x)).map(x => html`<option value=${x}>${x}</option>`)}</select>` : null}</div>
    ${c.derived && !compact ? html`<div class="small muted">Dodge ${c.derived.dodge} · Move ${c.derived.move} · ${c.derived.encumbrance} encumbrance${c.derived.notes?.length ? ' · ' + c.derived.notes.join(' ') : ''}</div>` : null}
  </div>`;
}

/** Player combat page. */
export function PlayerCombat({ v, charId }) {
  const c = v.characters[charId];
  if (!c) return html`<div class="empty">No character assigned to you yet. Ask the GM.</div>`;
  const enc = M.activeEncounterFor(v, charId);
  const incoming = Object.values(v.events).filter(e => (e.stage === 'awaiting-defense' && e.targetId === charId && e.defenseOptions) || (e.notifications || []).some(n => n.to === charId && !n.applied) || (e.kind === 'request' && e.actorId === charId && e.stage === 'pending'));
  return html`<div class="cols" style=${{ gridTemplateColumns: '300px 1fr 400px' }}>
    <div class="col">
      <${Panel} title=${c.name}><${Vitals} v=${v} c=${c} /><//>
      ${enc ? html`<${Panel} title=${`${enc.name} · Round ${enc.round}`} actions=${enc.order[enc.turn] === charId && !enc.break ? html`<button class="small primary" onClick=${() => run('enc.next', { id: enc.id, expect: charId })} title="End your turn (E)">End my turn ▶</button>` : null}>${enc.order.map((id, i) => html`<div class="row small"><span class=${i === enc.turn ? 'turn-marker' : 'dim'}>${i === enc.turn ? '▶' : '·'}</span><span class=${id === charId ? 'accent' : ''}>${v.characters[id]?.name}</span><span class="muted right">${v.characters[id]?.status || (v.characters[id]?.kind === 'pc' ? `${v.characters[id].session.hp}/${v.characters[id].build?.hp} HP` : '')}</span></div>`)}<//>` : html`<${Panel} title="Encounter"><div class="muted">No active encounter. You can still roll skills.</div><//>`}
    </div>
    <div class="col">
      ${incoming.length ? html`<${Panel} title="Needs your attention" cls="attention"><${EventFeed} v=${v} filter=${e => incoming.includes(e)} expanded=${true} /><//>` : null}
      <${Panel} title="Attack"><${AttackForm} v=${v} actorId=${charId} /><//>
      <${Panel} title="Maneuver"><${ManeuverBar} v=${v} actorId=${charId} /><//>
      <${Panel} title="Skill & attribute rolls"><${SkillRoller} v=${v} actorId=${charId} /><//>
    </div>
    <${Panel} title="Results"><div class="scroll h-lg"><${EventFeed} v=${v} filter=${e => e.actorId === charId || e.targetId === charId} empty="Your rolls appear here and on the GM dashboard." /></div><//>
  </div>`;
}
