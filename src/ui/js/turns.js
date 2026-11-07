// Turn cycle UI: "your turn" / "NPC turn" pop-ups, the turn ticker and break controls.
import { html, useState, useEffect, run, signed } from './ui.js';
import * as M from './model.js';

/* ----------------------------------------------------------- chime (Web Audio, no files) */
export function chime(kind = 'turn') {
  try {
    if (localStorage.getItem('sgc:chime') === 'false') return;
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const notes = kind === 'npc' ? [392, 330] : [523, 659, 784];
    notes.forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.12 + 0.25);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + i * 0.12); o.stop(ac.currentTime + i * 0.12 + 0.3);
    });
  } catch { /* audio not available */ }
}

/** The encounter this window cares about: the player's character's, or the GM's active one. */
export function focusEncounter(v, charId) {
  const list = Object.values(v.encounters || {}).filter(e => e.status === 'active');
  if (v.role === 'gm') return list[0] || null;
  return list.find(e => e.order.includes(charId)) || null;
}

function nextUp(v, enc) {
  for (let k = 1; k <= enc.order.length; k++) {
    const id = enc.order[(enc.turn + k) % enc.order.length];
    const c = v.characters[id];
    if (c && !(c.session?.conditions || []).some(x => x === 'Dead' || x === 'Unconscious')) return c;
  }
  return null;
}

/** What the character holds in hands and whether it can be used. */
function inHands(v, charId) {
  const it = M.equippedIn(v, charId, 'hands');
  if (!it) return null;
  return { it, name: M.itemName(v, it), busy: it.readyAt ? `${it.busy || 'readying'} — usable from round ${it.readyAt}` : null, ranged: M.def(v, it)?.weapon?.kind === 'ranged' };
}

/**
 * Pops up when the turn changes: players see "Your turn" for their character, the GM sees which
 * NPC acts (and who is next). Dismissing leaves a slim bar so the state is always visible.
 */
export function TurnBanner({ v, charId, go, selectChar }) {
  const enc = focusEncounter(v, charId);
  const actorId = enc ? enc.order[enc.turn] : null;
  const actor = actorId ? v.characters[actorId] : null;
  const key = enc && !enc.break ? `${enc.id}:${enc.round}:${enc.turn}` : enc?.break ? `${enc.id}:break` : '';
  const [dismissed, setDismissed] = useState('');
  const [seen, setSeen] = useState('');
  const gm = v.role === 'gm';
  const mine = !gm && actorId && (actorId === charId || v.characters[actorId]?.mine);
  const npcTurn = gm && actor?.kind === 'npc';
  useEffect(() => {
    if (!key || key === seen) return;
    setSeen(key);
    if (enc?.break) chime('turn');
    else if (mine) chime('turn');
    else if (npcTurn) chime('npc');
  }, [key]);
  if (!enc) return null;
  const end = () => run('enc.next', { id: enc.id, expect: actorId });

  if (enc.break) {
    const b = enc.break;
    const myLeft = !gm && charId ? b.remaining?.[charId] : null;
    const done = !gm && (b.done || []).includes(charId);
    return html`<div class="turn-bar break">
      <b>⏸ Break · ${b.seconds} s</b>
      ${gm ? html`<span class="grow small">${Object.entries(b.remaining || {}).map(([id, left]) => html`<span class="chip ${(b.done || []).includes(id) ? 'good' : left ? 'info' : ''}">${M.charName(v, id)}: ${(b.done || []).includes(id) ? 'done' : `${left} s left`}</span> `)}</span>
        <button class="primary" onClick=${() => run('enc.endBreak', { id: enc.id })}>End break ▶</button>`
      : html`<span class="grow">${myLeft !== null && myLeft !== undefined ? html`You have <b>${myLeft} s</b> — ready items, reload, swap parts, aim, patch up. Nobody attacks.` : 'Nobody attacks during the break.'}</span>
        ${myLeft !== null && myLeft !== undefined ? html`<button class=${done ? '' : 'primary'} disabled=${done} onClick=${() => run('enc.breakDone', { id: enc.id, charId })}>${done ? 'Waiting for the GM' : "I'm done ✓"}</button>` : null}`}
    </div>`;
  }

  const nxt = nextUp(v, enc);
  const spent = enc.combatants?.[actorId]?.turnSpent === enc.round;
  const popup = (mine || npcTurn) && dismissed !== key;
  const hand = mine ? inHands(v, actorId) : npcTurn ? inHands(v, actorId) : null;
  return html`${popup ? html`<div class="turn-pop-back" onMouseDown=${e => { if (e.target === e.currentTarget) setDismissed(key); }}>
      <div class="turn-pop ${npcTurn ? 'npc' : 'mine'}">
        <div class="turn-pop-kicker">${npcTurn ? 'NPC turn' : 'Your turn'} · Round ${enc.round}</div>
        <div class="turn-pop-name">${actor?.name}</div>
        ${(() => { const cs = enc.combatants?.[actorId]; const st = M.equippedIn(v, actorId, 'ready')?.stage; return cs?.turnSpent === enc.round ? html`<div class="small warn">⏭ This turn: ${cs.turnSpentOn || 'busy'}${st ? (st.kind === 'rounds' ? ' — continues next turn' : st.due > enc.round ? ` — done in round ${st.due}` : '') : ' — done'}. End your turn when ready.</div>` : st ? html`<div class="small">⏭ Ready slot: ${st.label}</div>` : null; })()}
        ${hand ? html`<div class="small">${hand.busy ? html`<span class="warn">✋ ${hand.name}: ${hand.busy}</span>` : html`✋ In hands: <b>${hand.name}</b>`}</div>` : html`<div class="small muted">Nothing in hands${mine ? ' — drag a weapon into the Hands slot to draw it (takes this turn).' : ''}</div>`}
        ${nxt ? html`<div class="tiny dim">Next: ${nxt.name}</div>` : null}
        <div class="row" style=${{ marginTop: '12px', justifyContent: 'center' }}>
          ${mine && spent ? html`<button class="primary big" onClick=${() => { setDismissed(key); end(); }}>End turn ▶</button>
            <button onClick=${() => { setDismissed(key); go('combat'); }}>Open combat</button>`
          : mine ? html`<button class="primary big" onClick=${() => { setDismissed(key); go('combat'); }}>Take my turn</button>
            ${hand?.ranged && !hand.busy ? html`<button onClick=${() => { setDismissed(key); run('weapon.reload', { weaponId: hand.it.id }, { ok: true }); }}>↻ Reload</button>` : null}
            <button onClick=${() => { setDismissed(key); end(); }}>End turn</button>`
          : html`<button class="primary big" onClick=${() => { setDismissed(key); selectChar(actorId); go('gm-dash'); }}>Control ${actor?.name}</button>
            <button onClick=${() => { setDismissed(key); end(); }}>Skip turn</button>`}
          <button class="ghost" onClick=${() => setDismissed(key)}>Close</button>
        </div>
      </div></div>` : null}
    <div class="turn-bar ${mine ? 'mine' : npcTurn ? 'npc' : ''}">
      <b>R${enc.round}</b>
      <span class="grow">${mine ? html`<b class="accent">▶ Your turn</b> — ${actor.name}${hand?.busy ? html` · <span class="warn">${hand.name} ${hand.busy}</span>` : ''}` : html`▶ ${actor?.name || '—'}'s turn${npcTurn ? ' (NPC)' : ''}`}${nxt ? html` <span class="dim">· next: ${nxt.name}</span>` : null}</span>
      ${mine || gm ? html`<button class=${mine ? 'primary' : ''} onClick=${end} title=${gm ? 'Next turn (N)' : 'End your turn (E)'}>${mine ? 'End my turn ▶' : 'Next turn ▶'}</button>` : null}
    </div>`;
}

/** GM break + start controls for an encounter. */
export function BreakControls({ v, enc }) {
  const [secs, setSecs] = useState(5);
  if (enc.status !== 'active') return null;
  if (enc.break) return html`<div class="col small"><div><b>Break running:</b> ${enc.break.seconds} s · clock resumes at round ${enc.break.fromRound + enc.break.seconds}</div>
    ${Object.entries(enc.break.remaining || {}).map(([id, left]) => html`<div class="row"><span class="grow">${M.charName(v, id)}</span><span class=${(enc.break.done || []).includes(id) ? 'good' : ''}>${(enc.break.done || []).includes(id) ? 'done' : `${left} s left`}</span></div>`)}
    <button class="primary" onClick=${() => run('enc.endBreak', { id: enc.id })}>End break ▶</button></div>`;
  return html`<div class="col small">
    <div class="row"><input type="number" min="1" max="600" value=${secs} onInput=${e => setSecs(e.target.value)} style=${{ width: '70px' }} /> seconds <button class="primary" onClick=${() => run('enc.break', { id: enc.id, seconds: Number(secs) })}>⏸ Start break</button></div>
    <div class="dim">A lull in the fighting. Each player gets that many seconds to ready items (1 s), reload (the weapon’s reload time), fit attachments (3 s), load magazines (2 rounds/s), aim (1 s each, kept afterwards) or use items. Nobody attacks; the turn order pauses. When you end the break the clock jumps ahead, half-finished readying completes and the order restarts from the top.</div>
  </div>`;
}
