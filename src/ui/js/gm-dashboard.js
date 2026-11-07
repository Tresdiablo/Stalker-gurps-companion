// GM Combat Dashboard: combatants (left), live activity feed with the pending-decision queue
// (center), selected target with manual adjustments and NPC actions (right).
import { html, useState, useEffect, run, runHost, Panel, Bar, signed, askNumber, tipProps, Tabs, useLocal, money } from './ui.js';
import * as M from './model.js';
import { EventFeed, EventCard } from './events.js';
import { AttackForm, SkillRoller, ManeuverBar, Vitals, weaponOptions } from './combat.js';
import { openSpawn } from './spawn.js';

function weaponSummary(v, c) {
  const w = ['hands', 'primary', 'holster', 'secondary', 'melee'].map(s => M.equippedIn(v, c.id, s)).find(i => i && M.def(v, i)?.weapon);
  if (!w) return (c.build?.weapons || [])[0] ? `${c.build.weapons[0].owner} ${c.build.weapons[0].damage}` : 'unarmed';
  return `${M.itemName(v, w)}${w.feed ? ` · ${w.feed.rounds}${w.feed.capacity ? '/' + w.feed.capacity : ''} rds` : ''}`;
}
function armorSummary(v, c) {
  const worn = ['helmet', 'face', 'armor', 'rig'].map(s => M.equippedIn(v, c.id, s)).filter(i => M.def(v, i)?.armor);
  return worn.map(i => `${M.def(v, i).armor.dr} ${M.def(v, i).armor.locations.slice(0, 2).join('/')}`).join(', ') || (c.build?.naturalDR?.all ? `natural ${c.build.naturalDR.all}` : 'none');
}

export function Combatant({ v, c, enc, i, sel, onSel }) {
  const turn = enc && enc.order[enc.turn] === c.id;
  const dead = c.session.conditions.includes('Dead') || c.derived?.state === 'dead';
  return html`<div class="combatant ${sel ? 'sel' : ''} ${dead ? 'dead' : ''}" onClick=${onSel}>
    <div class="row nowrap"><span class=${turn ? 'turn-marker' : 'dim'}>${turn ? '▶' : i + 1}</span><span class="nm grow">${c.name}</span><span class="chip ${c.kind === 'npc' ? 'bad' : 'info'}">${c.kind === 'npc' ? (c.faction || 'NPC') : 'PC'}</span></div>
    <div class="row nowrap" style=${{ marginTop: '4px' }}><div class="grow"><${Bar} cur=${c.session.hp} max=${c.build?.hp ?? 10} /></div><div style=${{ width: '70px' }}><${Bar} cur=${c.session.fp} max=${c.build?.fp ?? 10} kind="fp" /></div></div>
    <div class="tiny muted" style=${{ marginTop: '3px' }}>${weaponSummary(v, c)} · DR ${armorSummary(v, c)}</div>
    <div class="row" style=${{ gap: '3px', marginTop: '2px' }}>${c.derived?.state && c.derived.state !== 'healthy' ? html`<span class="chip warn">${c.derived.state}</span>` : null}${c.session.conditions.map(x => html`<span class="chip bad">${x}</span>`)}${enc?.combatants[c.id]?.aim ? html`<span class="chip good">aim ${enc.combatants[c.id].aim.turns}</span>` : null}${enc?.combatants[c.id]?.shock ? html`<span class="chip bad">shock ${enc.combatants[c.id].shock}</span>` : null}${c.session.posture !== 'standing' ? html`<span class="chip">${c.session.posture}</span>` : null}</div>
  </div>`;
}

const pendingFilter = M.needsGm;

const alive = c => c && !c.session.conditions.includes('Dead') && !c.session.conditions.includes('Unconscious') && c.derived?.state !== 'dead';

/** Nearest living enemy of `actor` by GM-set distance (falls back to the first living PC). */
function defaultTarget(v, enc, actor) {
  const foes = enc.order.map(id => v.characters[id]).filter(c => c && c.id !== actor.id && alive(c) && (actor.kind === 'npc' ? c.kind === 'pc' : c.kind === 'npc'));
  if (!foes.length) return '';
  const withD = foes.map(c => ({ c, d: M.distanceBetween(enc, actor.id, c.id) })).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
  return withD[0].c.id;
}

/**
 * NPC control: run an NPC's turn from one bar — pick who acts, their weapon and target
 * (the nearest player character is preselected), then Attack / Aim / Reload / Next turn.
 */
export function NpcControl({ v, enc, actorId, setActorId, setSelected }) {
  const npcs = enc.order.map(id => v.characters[id]).filter(c => c?.kind === 'npc');
  const turnId = enc.order[enc.turn];
  const actor = v.characters[actorId] && v.characters[actorId].kind === 'npc' ? v.characters[actorId] : v.characters[turnId]?.kind === 'npc' ? v.characters[turnId] : npcs.find(alive);
  const [wKey, setW] = useState('');
  const [tgt, setTgt] = useState('');
  const [shots, setShots] = useState(1);
  const [loc, setLoc] = useState('torso');
  const [secret, setSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!npcs.length) return null;
  if (!actor) return html`<div class="npc-bar"><span class="muted">All NPCs in this encounter are down.</span></div>`;
  const cs = enc.combatants[actor.id];
  const weapons = weaponOptions(v, actor).filter(o => !o.item || o.item.loc.g !== 'ground');
  const w = weapons.find(o => o.key === wKey) || weapons.find(o => o.item?.loc.slot === 'hands') || weapons.find(o => o.item && cs?.readyWeaponId === o.item.id) || weapons.find(o => o.kind === 'ranged' && o.rounds > 0) || weapons[0];
  const target = v.characters[tgt] && tgt !== actor.id ? tgt : (cs?.targetId && alive(v.characters[cs.targetId]) ? cs.targetId : defaultTarget(v, enc, actor));
  const rof = parseInt(w?.rof, 10) || 1;
  const maxShots = Math.max(1, Math.min(rof, w?.rounds === Infinity ? rof : w?.rounds || 1));
  const dist = target ? M.distanceBetween(enc, actor.id, target) : null;
  const isTurn = turnId === actor.id;
  const act = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const attack = () => act(() => run('combat.attack', { actorId: actor.id, targetId: target || null, weapon: w.ref, shots: Math.min(shots, maxShots), hitLocation: loc, encounterId: enc.id, visibility: secret ? 'gm' : 'public' }));
  const aim = () => act(() => run('combat.maneuver', { id: enc.id, charId: actor.id, maneuver: 'aim', weaponId: w?.item?.id, targetId: target, braced: false }));
  const reload = () => act(() => run('weapon.reload', { weaponId: w.item.id }, { ok: true }));
  const nextNpc = () => { const list = npcs.filter(alive); const i = list.findIndex(c => c.id === actor.id); const n = list[(i + 1) % list.length]; if (n) { setActorId(n.id); setSelected(n.id); setW(''); setTgt(''); } };
  return html`<div class="npc-bar ${isTurn ? 'their-turn' : ''}">
    <div class="row">
      <b class="npc-title">${isTurn ? '▶ NPC turn' : 'NPC control'}</b>
      <select value=${actor.id} onChange=${e => { setActorId(e.target.value); setSelected(e.target.value); setW(''); setTgt(''); }}>${npcs.map(c => html`<option value=${c.id}>${c.name}${alive(c) ? '' : ' (down)'}${c.id === turnId ? ' — their turn' : ''}</option>`)}</select>
      <button class="small ghost" onClick=${nextNpc} title="Next NPC">⟳</button>
      <span class="muted small">HP ${actor.session.hp}/${actor.build?.hp} · ${cs?.aim ? `aiming ${cs.aim.turns}` : 'not aiming'}${cs?.shock ? ` · shock ${cs.shock}` : ''}</span>
      <label class="row small right"><input type="checkbox" checked=${secret} onChange=${e => setSecret(e.target.checked)} /> Secret roll</label>
    </div>
    <div class="row" style=${{ marginTop: '6px' }}>
      <select value=${w?.key} onChange=${e => setW(e.target.value)} title="Weapon">${weapons.map(o => html`<option value=${o.key}>${o.label}</option>`)}${!weapons.length ? html`<option>unarmed</option>` : null}</select>
      <span>→</span>
      <select value=${target} onChange=${e => setTgt(e.target.value)} title="Target">${enc.order.filter(id => id !== actor.id && v.characters[id]).map(id => html`<option value=${id}>${v.characters[id].name}${v.characters[id].kind === 'npc' ? ' (NPC)' : ''}${M.distanceBetween(enc, actor.id, id) !== null ? ` · ${M.distanceBetween(enc, actor.id, id)} yd` : ''}</option>`)}</select>
      <select value=${loc} onChange=${e => setLoc(e.target.value)} title="Hit location">${M.LOCATIONS.map(([k, l, p]) => html`<option value=${k}>${l}${p ? ` ${p}` : ''}</option>`)}</select>
      ${w?.kind === 'ranged' && rof > 1 ? html`<label class="row small">Shots <input type="number" min="1" max=${maxShots} value=${Math.min(shots, maxShots)} onInput=${e => setShots(Math.max(1, Number(e.target.value) || 1))} style=${{ width: '52px' }} /></label>` : null}
      ${dist === null && target ? html`<span class="chip warn" title="Set it in the selected combatant's Distances">no distance set</span>` : null}
    </div>
    <div class="row" style=${{ marginTop: '6px' }}>
      ${w?.item && w.item.loc.slot !== 'hands' && v.settings?.rules?.readyRequired !== false ? html`<button class="good" disabled=${busy} onClick=${() => act(() => run('item.ready', { itemId: w.item.id, charId: actor.id }, { ok: true }))} title="Ready maneuver: usable next round. Right-click the item for Fast-Draw or instant readying.">✋ Draw (ready)</button>` : null}
      ${w?.item?.readyAt ? html`<span class="chip warn">${w.item.busy || 'readying'} → R${w.item.readyAt}</span>` : null}
      <button class="primary" disabled=${busy || !w || !alive(actor) || enc.break || (w.kind === 'ranged' && !w.rounds) || (w.item && ((v.settings?.rules?.readyRequired !== false && w.item.loc.slot !== 'hands') || (w.item.readyAt && enc.round < w.item.readyAt)))} onClick=${attack}>🎯 Attack${w?.kind === 'ranged' ? ` (${w.rounds === Infinity ? '∞' : w.rounds} rds)` : ''}</button>
      ${w?.item && w.kind === 'ranged' ? html`<button disabled=${busy} onClick=${reload} class=${!w.rounds ? 'good' : ''}>↻ Reload</button>` : null}
      <button disabled=${busy || !w?.item} onClick=${aim} title="Aim maneuver at the chosen target (adds Acc, then +1/+2)">Aim${cs?.aim ? ` (${cs.aim.turns})` : ''}</button>
      <select value="" onChange=${e => { if (e.target.value) run('combat.maneuver', { id: enc.id, charId: actor.id, maneuver: e.target.value, weaponId: w?.item?.id, targetId: target }); e.target.value = ''; }}><option value="">Other maneuver…</option>${M.MANEUVERS.filter(([k]) => !['attack', 'aim'].includes(k)).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <select value="" onChange=${e => { if (e.target.value) run('enc.combatant', { id: enc.id, charId: actor.id, posture: e.target.value }); e.target.value = ''; }}><option value="">Posture: ${actor.session.posture}</option>${M.POSTURES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      ${enc.status === 'active' ? html`<button class="right" onClick=${() => run('enc.next', { id: enc.id })} title="Next turn (N)">Next turn ▶</button>` : null}
    </div>
  </div>`;
}

export function GmDashboard({ v, selected, setSelected }) {
  const encs = Object.values(v.encounters).filter(e => e.status !== 'archived');
  const [encId, setEncId] = useLocal('gm-enc', null);
  const enc = encs.find(e => e.id === encId) || encs.find(e => e.status === 'active') || encs[0];
  const [filter, setFilter] = useLocal('gm-feed-filter', 'all');
  const [focus, setFocus] = useState(null);
  const [npcActor, setNpcActor] = useState(null);
  // follow the turn: when it becomes an NPC's turn, select that NPC for control
  const turnKey = enc ? `${enc.id}:${enc.round}:${enc.turn}` : '';
  useEffect(() => { const id = enc?.order[enc.turn]; if (enc?.status === 'active' && id) { setSelected(id); if (v.characters[id]?.kind === 'npc') setNpcActor(id); } }, [turnKey]);
  const ids = enc ? enc.order : Object.values(v.characters).filter(c => c.kind === 'pc').map(c => c.id);
  const sel = v.characters[selected] || v.characters[ids[0]];
  const pending = Object.values(v.events).filter(pendingFilter).sort((a, b) => a.seq - b.seq);
  // keyboard: N next turn, A apply focused/first pending, J/K move through queue
  useEffect(() => {
    const key = e => {
      if (e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey) return;
      if (e.key === 'n' && enc?.status === 'active' && !enc.break) run('enc.next', { id: enc.id, expect: enc.order[enc.turn] });
      if (e.key === 'a') { const ev = v.events[focus] || pending.find(x => x.stage === 'resolved' && x.proposal && !(x.applications || []).some(a => !a.undone)); if (ev?.proposal && ev.stage === 'resolved') run('combat.apply', { eventId: ev.id, mode: 'calculated' }, { ok: true }); }
      if (e.key === 'j' || e.key === 'k') { const i = pending.findIndex(x => x.id === focus); const n = pending[Math.max(0, Math.min(pending.length - 1, i + (e.key === 'j' ? 1 : -1)))]; if (n) setFocus(n.id); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const filters = { all: () => true, unresolved: pendingFilter, applied: e => e.stage === 'applied', ignored: e => e.stage === 'ignored', player: e => v.characters[e.actorId]?.kind === 'pc', npc: e => v.characters[e.actorId]?.kind === 'npc', resolved: e => e.stage === 'closed' || e.stage === 'applied' || (e.stage === 'resolved' && !M.needsGm(e)) };
  return html`<div class="col">
    <div class="row">
      <select value=${enc?.id || ''} onChange=${e => setEncId(e.target.value)}>${encs.map(e => html`<option value=${e.id}>${e.name} (${e.status})</option>`)}</select>
      ${enc ? html`<span class="chip ${enc.status === 'active' ? 'good' : ''}">${enc.status}</span><b>Round ${enc.round || '—'}</b>
        ${enc.status !== 'active' ? html`<button class="primary" onClick=${() => run('enc.start', { id: enc.id })}>Start encounter</button>` : enc.break ? html`<span class="chip info">⏸ break ${enc.break.seconds} s</span><button class="primary" onClick=${() => run('enc.endBreak', { id: enc.id })}>End break ▶</button>` : html`<button class="primary" onClick=${() => run('enc.next', { id: enc.id })} ...${tipProps('Next turn (N). Skips downed combatants, expires shock and temporary modifiers, finishes readying.')}>Next turn ▶</button>
          <button onClick=${async () => { const n = await askNumber('Break in the action — seconds', { value: 5, min: 1, max: 600, label: 'Seconds (each player gets this many seconds of actions; nobody attacks)' }); if (n) run('enc.break', { id: enc.id, seconds: n }); }} title="Pause the fighting for N seconds of free actions">⏸ Break…</button><button onClick=${() => run('enc.end', { id: enc.id })}>End</button>`}
        <label class="row small" ...${tipProps('Darkness/visibility penalty applied to attacks in this encounter (B394).')}>Darkness <input type="number" min="0" max="10" value=${enc.env?.darkness || 0} onChange=${e => run('enc.update', { id: enc.id, env: { darkness: Number(e.target.value) } })} style=${{ width: '50px' }} /></label>` : html`<span class="muted">No encounter yet.</span><button class="primary" onClick=${async () => { const r = await run('enc.create', { name: 'Quick encounter', participants: Object.values(v.characters).filter(c => c.kind === 'pc' && !c.archived).map(c => c.id) }); if (r) { setEncId(r.result.id); run('enc.start', { id: r.result.id }); } }} title="Creates and starts an encounter with every player character; add NPCs from the Encounter Manager or generate them there">⚡ Quick encounter with all PCs</button>`}
      <span class="right chip ${pending.length ? 'warn' : ''}">${pending.length} awaiting decision</span>
      <span class="kbd">N</span><span class="tiny dim">next turn</span><span class="kbd">A</span><span class="tiny dim">apply</span><span class="kbd">J/K</span><span class="tiny dim">queue</span><span class="kbd">G</span><span class="tiny dim">give item</span>
    </div>
    <div class="gm-dash">
      <${Panel} title="Combatants" flat=${true}><div class="scroll h-lg">${ids.map((id, i) => v.characters[id] ? html`<${Combatant} key=${id} v=${v} c=${v.characters[id]} enc=${enc} i=${i} sel=${sel?.id === id} onSel=${() => { setSelected(id); if (v.characters[id].kind === 'npc') setNpcActor(id); }} />` : null)}
        ${!ids.length ? html`<div class="empty">No combatants.</div>` : null}</div><//>
      <div class="col">
        ${enc ? html`<${NpcControl} v=${v} enc=${enc} actorId=${npcActor} setActorId=${setNpcActor} setSelected=${setSelected} />` : null}
        ${pending.length ? html`<${Panel} title=${`Pending actions (${pending.length})`}><div class="scroll" style=${{ maxHeight: '45vh' }}>${pending.map(ev => html`<${EventCard} key=${ev.id} v=${v} ev=${ev} focus=${focus === ev.id} onFocus=${() => setFocus(ev.id)} expanded=${true} />`)}</div><//>` : null}
        <${Panel} title="Combat activity" actions=${html`<${Tabs} tabs=${[['all', 'All'], ['unresolved', 'Unresolved'], ['resolved', 'Resolved'], ['applied', 'Applied'], ['ignored', 'Ignored'], ['player', 'Players'], ['npc', 'NPCs']]} value=${filter} onChange=${setFilter} />`}>
          <div class="scroll h-lg"><${EventFeed} v=${v} filter=${filters[filter] || filters.all} focusId=${focus} onFocus=${setFocus} /></div><//>
      </div>
      <${TargetPanel} v=${v} c=${sel} enc=${enc} />
    </div>
  </div>`;
}

export function TargetPanel({ v, c, enc }) {
  const [tab, setTab] = useLocal('gm-target-tab', 'status');
  if (!c) return html`<${Panel} title="Selected"><div class="empty">Select a combatant.</div><//>`;
  const cs = enc?.combatants?.[c.id];
  const quick = n => run('char.adjust', { id: c.id, hp: n, reason: 'GM quick adjust' });
  const pendingFor = Object.values(v.events).filter(e => e.stage === 'resolved' && e.proposal?.targetId === c.id && e.proposal.hp);
  const mainWeapon = ['hands', 'primary', 'secondary', 'holster'].map(sl => M.equippedIn(v, c.id, sl)).find(i => M.def(v, i)?.weapon?.kind === 'ranged');
  return html`<${Panel} title=${c.name} actions=${html`<button class="small" onClick=${() => openSpawn(v, 'char:' + c.id)} title="Spawn an item from the catalog into this character's inventory (G)">+ Give item</button><span class="chip">${c.kind === 'npc' ? 'NPC' : 'PC'}</span>`}>
    <div class="row nowrap" style=${{ alignItems: 'flex-start' }}>${c.portrait && M.imageUrl(v, c.portrait) ? html`<img class="portrait" src=${M.imageUrl(v, c.portrait)} />` : null}
      <div class="grow"><${Vitals} v=${v} c=${c} compact=${true} />
        <div class="row" style=${{ marginTop: '6px' }}>${[-1, -3, -5].map(n => html`<button class="small danger" onClick=${() => quick(n)}>${n}</button>`)}<button class="small" onClick=${async () => { const n = await askNumber('HP change (negative = damage)', { value: -1, min: -999, max: 999 }); if (n) quick(n); }}>±…</button>${[1, 3].map(n => html`<button class="small good" onClick=${() => quick(n)}>+${n}</button>`)}
          <button class="small" onClick=${async () => { const n = await askNumber('FP change', { value: -1, min: -99, max: 99 }); if (n) run('char.adjust', { id: c.id, fp: n }); }}>FP…</button></div></div></div>
    ${pendingFor.length ? html`<div class="notice-bar" style=${{ marginTop: '8px' }}>${pendingFor.map(e => html`<div class="row small"><span class="grow">Pending: ${signed(e.proposal.hp)} HP from ${M.charName(v, e.actorId)}</span><button class="small good" onClick=${() => run('combat.apply', { eventId: e.id, mode: 'calculated' }, { ok: true })}>Apply</button></div>`)}</div>` : null}
    <div style=${{ margin: '8px 0' }}><${Tabs} tabs=${[['status', 'Status'], ['act', 'Act'], ['roll', 'Rolls'], ['gear', 'Gear']]} value=${tab} onChange=${setTab} /></div>
    ${tab === 'status' ? html`<div class="col small">
      <div class="row">Dodge ${c.derived?.dodge} · Move ${c.derived?.move} · ${c.derived?.encumbrance} · ${weaponSummary(v, c)}${mainWeapon ? html`<button class="small right" onClick=${() => run('weapon.reload', { weaponId: mainWeapon.id }, { ok: true })}>↻ Reload</button>` : null}</div>
      <div>Armor DR: ${armorSummary(v, c)}</div>
      ${enc && cs ? html`<div class="form">
        <label class="field">Posture<select value=${cs.posture} onChange=${e => run('enc.combatant', { id: enc.id, charId: c.id, posture: e.target.value })}>${M.POSTURES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label class="field">Cover<select value=${cs.cover} onChange=${e => run('enc.combatant', { id: enc.id, charId: c.id, cover: e.target.value })}>${M.COVER.map(([k, l, m]) => html`<option value=${k}>${l}${m ? ` (${m})` : ''}</option>`)}</select></label>
        <label class="field">Size modifier<input type="number" value=${cs.sm} onChange=${e => run('enc.combatant', { id: enc.id, charId: c.id, sm: Number(e.target.value) })} /></label>
        <label class="field">Speed (yd/s)<input type="number" min="0" value=${cs.speed} onChange=${e => run('enc.combatant', { id: enc.id, charId: c.id, speed: Number(e.target.value) })} /></label>
      </div>
      <h3 class="row">Distances (yards)<span class="right row small" style=${{ textTransform: 'none', letterSpacing: 0 }}><input type="number" min="0" placeholder="yd" id="allDist" style=${{ width: '64px' }} /><button class="small" title="Set this distance to every opponent at once" onClick=${async () => { const y = Number(document.getElementById('allDist').value); if (!(y >= 0) || document.getElementById('allDist').value === '') return; for (const id of enc.order.filter(x => x !== c.id && v.characters[x] && v.characters[x].kind !== c.kind)) await run('enc.distance', { id: enc.id, a: c.id, b: id, yards: y }); }}>to all opponents</button></span></h3>
      ${enc.order.filter(id => id !== c.id).map(id => html`<div class="row"><span class="grow">${M.charName(v, id)}</span><input type="number" min="0" value=${M.distanceBetween(enc, c.id, id) ?? ''} placeholder="unset" onChange=${e => e.target.value !== '' && run('enc.distance', { id: enc.id, a: c.id, b: id, yards: Number(e.target.value) })} style=${{ width: '80px' }} /></div>`)}
      <div class="row"><button class="small" onClick=${async () => { const t = await askNumber('Temporary modifier value', { value: -2, min: -20, max: 20 }); if (t === null) return; const r = await askNumber('Lasts how many rounds?', { value: 1, min: 1, max: 100 }); run('enc.combatant', { id: enc.id, charId: c.id, tempMod: { label: 'GM modifier', value: t, rounds: r } }); }}>+ Temporary modifier</button>
        ${cs.tempMods.map(m => html`<span class="chip info">${m.label} ${signed(m.value)}${m.expiresRound ? ` →R${m.expiresRound}` : ''}<button onClick=${() => run('enc.combatant', { id: enc.id, charId: c.id, removeTempMod: m.id })}>✕</button></span>`)}</div>
      ${c.kind === 'npc' ? html`<div class="row">${c.session.conditions.includes('Dead') || c.session.hp <= 0 ? html`<button class="small" onClick=${() => run('enc.releaseLoot', { id: enc.id, charId: c.id, release: !(enc.lootReleased || []).includes(c.id) })}>${(enc.lootReleased || []).includes(c.id) ? 'Lock loot' : 'Release loot to players'}</button>` : null}
        <button class="small" onClick=${() => run('npc.reveal', { id: c.id, reveal: c.hidden })}>${c.hidden ? 'Reveal to players' : 'Hide from players'}</button></div>` : null}` : html`<div class="muted">Not in the selected encounter.</div>`}
      ${c.gmNotes ? html`<div class="notice-bar info">${c.gmNotes}</div>` : null}
    </div>` : null}
    ${tab === 'act' ? html`<div class="col">${c.kind === 'pc' ? html`<div class="notice-bar info small">Acting for a player character as GM.</div>` : null}<${ManeuverBar} v=${v} actorId=${c.id} /><${AttackForm} v=${v} actorId=${c.id} /></div>` : null}
    ${tab === 'roll' ? html`<div class="col"><${SkillRoller} v=${v} actorId=${c.id} />${c.kind === 'pc' ? html`<${RequestRoll} v=${v} c=${c} />` : null}<${ContestRoll} v=${v} c=${c} enc=${enc} /></div>` : null}
    ${tab === 'gear' ? html`<div class="col small">${M.owned(v, c.id).filter(i => i.loc.slot !== undefined).map(i => html`<div class="row">${i.loc.slot}: <b>${M.itemName(v, i)}</b>${i.feed ? ` · ${i.feed.rounds} rds` : ''}${i.cond < 100 ? ` · ${i.cond}%` : ''}${M.def(v, i)?.weapon?.kind === 'ranged' ? html`<button class="small right" onClick=${() => run('weapon.reload', { weaponId: i.id }, { ok: true })}>↻</button>` : null}</div>`)}
      <div class="row"><button class="small" onClick=${() => openSpawn(v, 'char:' + c.id)}>+ Give item…</button><span class="muted">Full inventory: NPC / Character Manager.</span></div><div>${money(c.session.money)}</div></div>` : null}
  <//>`;
}

function RequestRoll({ v, c }) {
  const [skill, setSkill] = useState('Observation');
  const [mod, setMod] = useState(0);
  const [vis, setVis] = useState('hidden');
  return html`<div class="panel"><div class="body col"><h3>Request a roll from the player</h3>
    <div class="row"><input list="skill-list" value=${skill} onInput=${e => setSkill(e.target.value)} /><datalist id="skill-list">${(c.build?.skills || []).map(s => html`<option value=${s.spec ? `${s.name} (${s.spec})` : s.name} />`)}</datalist>
    <input type="number" value=${mod} onInput=${e => setMod(Number(e.target.value) || 0)} style=${{ width: '56px' }} /><select value=${vis} onChange=${e => setVis(e.target.value)}><option value="public">Public</option><option value="hidden">Concealed target</option><option value="gm">GM only</option></select>
    <button class="primary" onClick=${() => run('roll.request', { actorId: c.id, skill, mods: mod ? [{ label: 'GM modifier', value: mod }] : [], visibility: vis }, { ok: 'Roll requested' })}>Request</button></div></div></div>`;
}

function ContestRoll({ v, c, enc }) {
  const others = enc ? enc.order.filter(id => id !== c.id) : Object.keys(v.characters).filter(id => id !== c.id);
  const [b, setB] = useState(others[0] || '');
  const [sa, setSa] = useState('DX'); const [sb, setSb] = useState('DX');
  return html`<div class="panel"><div class="body col"><h3>Quick contest (B348)</h3><div class="row">
    <input value=${sa} onInput=${e => setSa(e.target.value)} style=${{ width: '110px' }} /><span>vs</span>
    <select value=${b} onChange=${e => setB(e.target.value)}>${others.map(id => html`<option value=${id}>${M.charName(v, id)}</option>`)}</select>
    <input value=${sb} onInput=${e => setSb(e.target.value)} style=${{ width: '110px' }} /><button onClick=${() => run('roll.contest', { a: c.id, b, skillA: sa, skillB: sb })}>Roll contest</button></div></div></div>`;
}
