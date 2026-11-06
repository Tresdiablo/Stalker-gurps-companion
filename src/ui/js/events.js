// Combat/roll event cards used by the GM feed and the player feed. Readable summary first;
// click to expand the full calculation. GM decision controls live on the card.
import { html, useState, run, Dice, signed, fmtTime, askNumber, tipProps } from './ui.js';
import * as M from './model.js';

const STAGE = { calculated: 'Calculated', 'awaiting-defense': 'Awaiting defense', resolved: 'Awaiting GM decision', applied: 'Applied', ignored: 'Ignored', closed: 'Resolved', pending: 'Requested', secret: 'Secret' };

function Result({ roll }) {
  if (!roll) return null;
  if (roll.success === undefined) return html`<span class="muted">rolled ${roll.total}</span>`;
  const cls = roll.critical ? 'result-crit' : roll.success ? 'result-success' : 'result-failure';
  return html`<span class=${cls}>${roll.label || (roll.success ? 'Success' : 'Failure')}</span>`;
}

function Mods({ base, baseLabel, mods, effective }) {
  return html`<div class="breakdown">
    ${base !== undefined ? html`<div><span>${baseLabel || 'Base skill'}</span><b>${base}</b></div>` : null}
    ${(mods || []).map(m => html`<div><span>${m.label} <span class="src">${m.source || ''}</span></span><b>${signed(m.value)}</b></div>`)}
    ${effective !== undefined ? html`<div style=${{ borderTop: '1px solid #2a3b48', marginTop: '3px', paddingTop: '3px' }}><span>Effective skill</span><b>${effective}</b></div>` : null}
  </div>`;
}

export function summary(v, ev) {
  const a = ev.attack;
  if (ev.kind === 'attack' && a) {
    const parts = [`${a.weapon?.name || ''}`];
    if (a.roll?.total !== undefined && a.effective !== undefined) parts.push(`${a.roll.total} vs ${a.effective}`);
    if (ev.defense) parts.push(ev.defense.type === 'none' ? 'no defense' : `${ev.defense.label || ev.defense.type} ${ev.defense.roll ? (ev.defense.roll.success ? 'succeeded' : 'failed') : ev.defense.success ? 'succeeded' : 'failed'}`);
    if (ev.damage?.totalInjury !== undefined) parts.push(`${ev.damage.totalInjury} injury`);
    return parts.join(' · ');
  }
  if (ev.kind === 'skill') return ev.effective !== undefined ? `${ev.roll.total} vs ${ev.effective} (margin ${signed(ev.roll.margin)})` : `rolled ${ev.roll?.total ?? '?'}`;
  return ev.status || '';
}

export function EventCard({ v, ev, focus, onFocus, compact, expanded }) {
  const [open, setOpen] = useState(!!focus || !!expanded);
  const gm = v.role === 'gm';
  const actor = v.characters[ev.actorId], target = v.characters[ev.targetId];
  const a = ev.attack;
  return html`<div class="event ${ev.stage} ${ev.kind} ${focus ? 'focus' : ''}" onClick=${onFocus}>
    <div class="head" onClick=${() => setOpen(o => !o)}>
      <span class="grow"><span class="title">${ev.title}</span><br /><span class="small muted">${summary(v, ev)}</span></span>
      ${a?.roll ? html`<${Result} roll=${a.roll} />` : ev.roll ? html`<${Result} roll=${ev.roll} />` : null}
      <span class="chip stage-chip ${ev.stage === 'applied' ? 'good' : ev.stage === 'resolved' || ev.stage === 'awaiting-defense' ? 'warn' : ''}">${STAGE[ev.stage] || ev.stage}</span>
      <span class="when">${ev.round ? `R${ev.round} · ` : ''}${fmtTime(ev.at)}</span>
    </div>
    ${open && !compact ? html`<div class="bodyx" onClick=${e => e.stopPropagation()}>
      ${ev.kind === 'attack' && a ? html`<${AttackDetail} v=${v} ev=${ev} gm=${gm} />` : null}
      ${ev.kind === 'skill' ? html`<div class="lines"><span>Character</span><span>${actor?.name}</span><span>Roll</span><span>${ev.skill}${ev.visibility !== 'public' ? html` <span class="chip warn">${ev.visibility === 'gm' ? 'GM only' : 'concealed target'}</span>` : null}</span>
        <span>Dice</span><span><${Dice} dice=${ev.roll?.dice} /> = ${ev.roll?.total}</span>${ev.effective !== undefined ? html`<span>Margin</span><span>${signed(ev.roll.margin)}</span>` : null}${ev.note ? html`<span>Note</span><span>${ev.note}</span>` : null}</div>
        ${ev.effective !== undefined ? html`<${Mods} base=${ev.baseSkill} baseLabel=${`Base: ${ev.baseExplain || ''}`} mods=${ev.mods} effective=${ev.effective} />` : null}` : null}
      ${ev.kind === 'use' ? html`<div class="lines"><span>Item</span><span>${ev.use?.item}</span>${ev.use?.roll ? html`<span>Roll</span><span><${Dice} dice=${ev.use.roll.dice} /> ${ev.use.roll.label}</span>` : null}<span>Proposed</span><span>${ev.status}</span></div>${(ev.use?.notes || []).map(n => html`<div class="small muted">${n}</div>`)}` : null}
      ${ev.kind === 'contest' && ev.contest ? html`<div class="lines"><span>${actor?.name}</span><span>${ev.contest.skillA} ${ev.contest.levelA}: <${Dice} dice=${ev.contest.a.dice} /> margin ${signed(ev.contest.a.margin)}</span><span>${target?.name}</span><span>${ev.contest.skillB} ${ev.contest.levelB}: <${Dice} dice=${ev.contest.b.dice} /> margin ${signed(ev.contest.b.margin)}</span><span>Outcome</span><span>${ev.status}</span></div>` : null}
      ${ev.kind === 'roll' && ev.free ? html`<div><${Dice} dice=${ev.free.dice} /> ${ev.free.add ? signed(ev.free.add) : ''} = <b>${ev.free.total}</b></div>` : null}
      ${ev.kind === 'adjust' ? html`<div class="small muted">${ev.reason || ''}</div>` : null}
      ${(ev.warnings || []).map(w => html`<div class="small warn">⚠ ${w}</div>`)}
      ${(ev.overrides || []).map(o => html`<div class="small accent">GM override: ${o.field} ${JSON.stringify(o.from)} → ${JSON.stringify(o.to)}</div>`)}
      <${EventActions} v=${v} ev=${ev} gm=${gm} />
    </div>` : null}
  </div>`;
}

function AttackDetail({ v, ev, gm }) {
  const a = ev.attack;
  return html`<div class="lines">
    <span>Attacker</span><span>${v.characters[ev.actorId]?.name || '—'}</span>
    <span>Target</span><span>${v.characters[ev.targetId]?.name || '—'}${a.hitLocation ? ` · ${a.hitLocation}` : ''}${a.range !== null && a.range !== undefined ? ` · ${a.range} yd` : ''}</span>
    <span>Weapon</span><span>${a.weapon?.name}${a.ammo ? ` · ${a.ammo.name}` : ''}${a.shots > 1 ? ` · ${a.shots} shots` : ''}</span>
    ${a.roll?.dice ? html`<span>Attack roll</span><span><${Dice} dice=${a.roll.dice} /> = ${a.roll.total}${a.effective !== undefined ? ` vs ${a.effective} · margin ${signed(a.roll.margin)}` : ''}</span>` : null}
    ${a.hits !== undefined ? html`<span>Hits</span><span>${a.hits}${a.maxHits > 1 ? ` of ${a.maxHits} possible (1 + margin ÷ Rcl ${a.weapon?.rcl})` : ''}</span>` : null}
    ${ev.defense ? html`<span>Defense</span><span>${ev.defense.type === 'none' ? `None (${ev.defense.reason || 'declined'})` : html`${ev.defense.label}${ev.defense.roll ? html`: <${Dice} dice=${ev.defense.roll.dice} /> = ${ev.defense.roll.total}${ev.defense.effective !== undefined ? ` vs ${ev.defense.effective}` : ''} — ${ev.defense.roll.success ? 'success' : 'failure'}` : ev.defense.success ? ' — success' : ' — failed'}${ev.defense.hitsDefended ? ` · ${ev.defense.hitsDefended} hit(s) avoided` : ''}`}</span>` : null}
    ${ev.damage?.totalInjury !== undefined ? html`<span>Calculated injury</span><span><b>${ev.damage.totalInjury} HP</b>${ev.damage.totalFP ? ` · ${ev.damage.totalFP} FP` : ''}${ev.damage.shock ? ` · shock ${ev.damage.shock}` : ''}</span>` : null}
    ${ev.applied ? html`<span>Applied</span><span>${signed(ev.applied.hp)} HP</span>` : null}
  </div>
  ${a.crit ? html`<div class="small accent">${a.crit}</div>` : null}
  ${a.mods ? html`<${Mods} base=${a.baseSkill} baseLabel=${`Base: ${a.baseSkillExplain || ''}`} mods=${a.mods} effective=${a.effective} />` : null}
  ${ev.defense?.mods?.length ? html`<${Mods} base=${ev.defense.base} baseLabel="Defense base" mods=${ev.defense.mods} effective=${ev.defense.effective} />` : null}
  ${ev.damage?.hits?.map((h, i) => html`<div class="breakdown"><div><span><b>Hit ${i + 1}</b> · ${h.location}${h.locRoll ? ` (rolled ${h.locRoll.reduce((x, y) => x + y, 0)})` : ''} · ${h.damageText || ''} ${h.dice ? html`<${Dice} dice=${h.dice} />` : ''}</span><b>${h.basic} basic</b></div>
    ${h.dr !== undefined ? html`<div><span>DR ${h.dr}${h.effectiveDR !== undefined && h.effectiveDR !== h.dr ? ` → effective ${h.effectiveDR}` : ''} · penetrating ${h.penetrating ?? ''} × ${h.mult ?? ''}</span><b>${h.injury} injury</b></div>` : null}
    ${(h.steps || []).map(s => html`<div class="src">${s}</div>`)}
    ${gm && ev.stage === 'resolved' ? html`<div><span></span><button class="small" onClick=${async () => { const n = await askNumber('Set injury for this hit', { value: h.injury, min: 0, max: 999 }); if (n !== null) run('combat.override', { eventId: ev.id, field: 'hitInjury', value: n, hitIndex: i }); }}>Adjust</button></div>` : null}
  </div>`)}
  ${gm ? (ev.damage?.followUps || []).map((f, i) => html`<div class="row small"><span class="warn">↳ ${f.label}</span>
      ${f.kind !== 'cripple' ? (f.result ? html`<span><${Dice} dice=${f.result.roll.dice} /> vs ${f.result.effective}: ${f.result.roll.label}</span>${(f.suggest || []).map(c => html`<button class="small" onClick=${() => run('char.adjust', { id: ev.targetId, conditionsAdd: [c], reason: f.label })}>Apply ${c}</button>`)}` : html`<button class="small" onClick=${() => run('combat.followUp', { eventId: ev.id, index: i })}>Roll HT</button>`) : null}</div>`) : (ev.damage?.notes || []).map(n => html`<div class="small warn">${n}</div>`)}
  ${gm ? (ev.damage?.notes || []).map(n => html`<div class="small warn">${n}</div>`) : null}`;
}

function EventActions({ v, ev, gm }) {
  const target = v.characters[ev.targetId];
  const mineTarget = !!target?.mine;
  const btns = [];
  if (ev.stage === 'awaiting-defense' && (gm || mineTarget)) {
    for (const o of ev.defenseOptions || []) btns.push(html`<button class=${o.type === 'none' ? '' : 'primary'} onClick=${() => run('combat.defend', { eventId: ev.id, type: o.type, label: o.type === 'none' ? undefined : o.label })}>${o.type === 'none' ? 'No defense' : `Roll ${o.label} ${o.value}`}</button>`);
    if (ev.attack?.weapon?.kind === 'ranged') btns.push(html`<button onClick=${() => run('combat.defend', { eventId: ev.id, type: 'dodge', dodgeAndDrop: true })} ...${tipProps('Dodge and Drop: +3 Dodge vs ranged attacks; you end up prone (B377).')}>Dodge & Drop</button>`);
    if (ev.attack?.weapon?.kind === 'melee') btns.push(html`<button onClick=${() => run('combat.defend', { eventId: ev.id, type: 'dodge', retreat: true })}>Dodge + Retreat</button>`);
  }
  if (gm) {
    const active = (ev.applications || []).find(x => !x.undone);
    if (ev.stage === 'resolved' && ev.proposal && !active) {
      btns.push(html`<button class="good" title="A" onClick=${() => run('combat.apply', { eventId: ev.id, mode: 'calculated' }, { ok: true })}>Apply calculated (${signed(ev.proposal.hp)} HP${ev.proposal.fp ? `, ${signed(ev.proposal.fp)} FP` : ''})</button>`);
    }
    if (['resolved', 'ignored', 'closed'].includes(ev.stage) && !active && ev.targetId) {
      btns.push(html`<button onClick=${async () => { const n = await askNumber('Custom HP change (negative = damage)', { value: ev.proposal?.hp || -1, min: -999, max: 999 }); if (n !== null) run('combat.apply', { eventId: ev.id, mode: 'custom', hp: n }, { ok: true }); }}>Custom HP…</button>`);
      btns.push(html`<button onClick=${async () => { const n = await askNumber('FP change (negative = loss)', { value: -1, min: -99, max: 99 }); if (n !== null) run('combat.apply', { eventId: ev.id, mode: 'custom', hp: 0, fp: n }); }}>FP…</button>`);
    }
    if (ev.stage === 'resolved' && !active && ev.kind !== 'skill') btns.push(html`<button onClick=${() => run('combat.ignore', { eventId: ev.id })}>Ignore</button>`);
    if (ev.stage === 'resolved' && target?.kind === 'pc' && ev.proposal?.hp) btns.push(html`<button onClick=${() => run('combat.notify', { eventId: ev.id }, { ok: 'Player notified' })}>Notify player</button>`);
    if (active) btns.push(html`<button class="danger" onClick=${() => run('combat.undo', { eventId: ev.id }, { ok: true })}>Undo (${signed(active.hp)} HP)</button>`);
    if (!['closed', 'applied', 'ignored', 'awaiting-defense'].includes(ev.stage)) btns.push(html`<button class="ghost" onClick=${() => run('combat.close', { eventId: ev.id })}>Mark resolved</button>`);
    if (ev.kind === 'attack' && !active) btns.push(html`<button class="ghost small" onClick=${async () => { const n = await askNumber('Override effective skill', { value: ev.attack.effective, min: -30, max: 40 }); if (n !== null) run('combat.override', { eventId: ev.id, field: 'effective', value: n }); }}>Override skill</button>`,
      html`<button class="ghost small" onClick=${() => run('combat.override', { eventId: ev.id, field: 'attackSuccess', value: !ev.attack.roll.success })}>Force ${ev.attack.roll.success ? 'miss' : 'hit'}</button>`,
      ev.attack.maxHits > 1 ? html`<button class="ghost small" onClick=${async () => { const n = await askNumber('Number of hits', { value: ev.attack.hits, min: 0, max: ev.attack.maxHits }); if (n !== null) run('combat.override', { eventId: ev.id, field: 'hits', value: n }); }}>Set hits</button>` : null,
      html`<select class="small" value="" onChange=${e => e.target.value && run('combat.override', { eventId: ev.id, field: 'target', value: e.target.value })}><option value="">Change target…</option>${Object.values(v.characters).filter(c => c.id !== ev.actorId).map(c => html`<option value=${c.id}>${c.name}</option>`)}</select>`);
    if ((ev.kind === 'skill') && !active) btns.push(html`<button class="ghost small" onClick=${() => run('combat.override', { eventId: ev.id, field: 'success', value: !ev.roll.success })}>Force ${ev.roll.success ? 'failure' : 'success'}</button>`);
    if (ev.kind === 'use' && ev.stage === 'resolved' && !active) btns.push(html`<button class="good" onClick=${() => run('combat.apply', { eventId: ev.id, mode: 'calculated' })}>Apply ${signed(ev.proposal?.hp || 0)} HP</button>`);
  } else {
    for (const n of ev.notifications || []) {
      btns.push(html`<span class="notice-bar small">${n.text}</span>`);
      if (!n.applied) btns.push(html`<button class="primary" onClick=${() => run('combat.ackNotification', { eventId: ev.id, notifId: n.id }, { ok: true })}>Apply ${signed(n.hp)} HP to my character</button>`);
      else btns.push(html`<span class="chip good">applied</span>`);
    }
    if (ev.kind === 'use' && ev.stage === 'resolved' && ev.proposal && target?.mine && !(ev.applications || []).some(x => !x.undone)) btns.push(html`<button class="good" onClick=${() => run('combat.applySelf', { eventId: ev.id }, { ok: true })}>Apply ${signed(ev.proposal.hp)} HP</button>`);
    if (ev.kind === 'request' && v.characters[ev.actorId]?.mine && ev.stage === 'pending') btns.push(html`<span class="muted small">${ev.note}</span><button class="primary" onClick=${() => run('roll.skill', { actorId: ev.actorId, skill: ev.skill, requestEventId: ev.id })}>Roll ${ev.skill}</button>`);
  }
  return btns.length ? html`<div class="actions">${btns}</div>` : null;
}

/** Event feed with filters. */
export function EventFeed({ v, filter = () => true, empty = 'No activity yet.', focusId, onFocus, limit = 120, expanded }) {
  const list = Object.values(v.events || {}).filter(filter).sort((a, b) => b.seq - a.seq).slice(0, limit);
  if (!list.length) return html`<div class="empty">${empty}</div>`;
  return html`<div>${list.map(ev => html`<${EventCard} key=${ev.id} v=${v} ev=${ev} focus=${focusId === ev.id} onFocus=${() => onFocus?.(ev.id)} expanded=${expanded} />`)}</div>`;
}
