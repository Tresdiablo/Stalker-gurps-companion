// Equipment / weapon customization: large assembled preview, mount drop targets, magazine and
// ammunition handling, effective statistics.
import { html, useState, run, Panel, signed, tipProps } from './ui.js';
import * as M from './model.js';
import { ItemArt, itemMenu, Tile, inspect } from './inventory.js';

export function WeaponWorkbench({ v, charId, weaponId, setWeaponId }) {
  const c = v.characters[charId];
  if (!c) return html`<div class="empty">Choose a character.</div>`;
  const weapons = M.owned(v, charId).filter(i => M.def(v, i)?.weapon && i.loc.mount === undefined);
  const w = v.items[weaponId] && weapons.some(x => x.id === weaponId) ? v.items[weaponId] : weapons[0];
  const ctx = { charId };
  if (!w) return html`<div class="empty">${c.name} carries no weapons. Pick one up in the Inventory.</div>`;
  const d = M.def(v, w);
  const inst = M.installed(v, w);
  const parts = M.owned(v, charId).filter(i => (M.def(v, i)?.attachment || M.def(v, i)?.magazine) && i.loc.mount === undefined);
  const PW = 620, PH = Math.max(160, Math.round(620 * d.h / d.w));
  const st = w.stats || {};
  return html`<div class="cols" style=${{ gridTemplateColumns: '260px 1fr 340px' }}>
    <${Panel} title="Weapons"><div class="col">${weapons.map(x => html`<div class="list-item ${x.id === w.id ? 'sel' : ''}" onClick=${() => setWeaponId(x.id)} onContextMenu=${e => itemMenu(e, v, x, ctx)}>
      <div style=${{ width: '90px', height: '34px', position: 'relative' }}><${ItemArt} v=${v} item=${x} w=${90} h=${34} /></div><span class="grow small">${M.itemName(v, x)}<br /><span class="dim">${x.loc.slot || 'stowed'}</span></span></div>`)}</div><//>
    <div class="col">
      <${Panel} title=${M.itemName(v, w)} actions=${html`<button class="small" onClick=${() => inspect(v, w)}>Inspect</button>`}>
        <div style=${{ position: 'relative', width: PW + 'px', height: PH + 'px', maxWidth: '100%', background: '#0b141b', border: '1px solid var(--line2)', borderRadius: '4px', margin: 'auto' }} onContextMenu=${e => itemMenu(e, v, w, ctx)}>
          <${ItemArt} v=${v} item=${w} w=${PW} h=${PH} />
        </div>
        <div class="tiny dim" style=${{ textAlign: 'center', marginTop: '4px' }}>Attachments are layered onto the base artwork at the weapon's anchor points (edited by the GM in the Item Editor). Drag parts onto a mount below, or right-click the weapon.</div>
      <//>
      <${Panel} title="Mounts">
        <div class="cols c2">${d.weapon.mounts.map(m => { const a = inst[m.id]; return html`<div class="slot" style=${{ minHeight: '66px' }} data-drop="mount" data-weapon=${w.id} data-mount=${m.id} ...${tipProps(`${m.label}\nAccepts: ${m.interfaces.join(', ') || '—'}`)}>
          <span class="lbl">${m.label}</span>
          ${a ? html`<div class="row" style=${{ marginTop: '12px' }}><span>${M.itemName(v, a)}${M.def(v, a)?.magazine ? ` · ${M.roundCount(a.rounds)}/${M.def(v, a).magazine.capacity}` : ''}</span><button class="small" onClick=${() => run(m.slot === 'magazine' ? 'item.ejectMag' : 'item.detach', m.slot === 'magazine' ? { weaponId: w.id } : { weaponId: w.id, mountId: m.id })}>Remove</button></div>` : html`<span class="dim tiny">${m.interfaces.join(' / ')}</span>`}
        </div>`; })}</div>
        ${d.weapon.integral ? html`<div class="row" style=${{ marginTop: '8px' }}><span>${d.weapon.integral.label}: <b>${M.roundCount(w.rounds)}/${d.weapon.integral.capacity}</b></span><button class="small" onClick=${() => run('item.quickLoad', { holderId: w.id })}>Quick load</button><button class="small" onClick=${() => run('item.unload', { holderId: w.id })}>Unload</button></div>` : null}
        ${!d.weapon.integral && d.weapon.kind === 'ranged' ? html`<div class="row small" style=${{ marginTop: '8px' }}><span>Chamber: <b>${w.feed?.chamber ? v.defs[w.feed.chamber]?.name : 'empty'}</b></span>${!w.feed?.chamber && w.feed?.magazineId ? html`<button class="small" onClick=${() => run('item.chamber', { weaponId: w.id })}>Chamber round</button>` : null}</div>` : null}
      <//>
    </div>
    <div class="col">
      <${Panel} title="Effective statistics">
        <div class="lines small" style=${{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 12px' }}>
          <span class="muted">Skill</span><span>${d.weapon.skill}</span><span class="muted">Damage</span><span>${d.weapon.damage}</span>
          ${d.weapon.kind === 'ranged' ? html`<span class="muted">Acc</span><span>${st.acc ?? d.weapon.acc}${st.scope ? ` + scope ${st.scope}` : ''}</span><span class="muted">Range</span><span>${d.weapon.range}</span><span class="muted">RoF</span><span>${d.weapon.rof}</span><span class="muted">Shots</span><span>${d.weapon.shots}</span><span class="muted">Bulk</span><span>${st.bulk ?? d.weapon.bulk}</span><span class="muted">Rcl</span><span>${st.rcl ?? d.weapon.rcl}</span><span class="muted">Calibers</span><span>${d.weapon.calibers.join(', ')}</span><span class="muted">Magazines</span><span>${d.weapon.integral ? 'internal' : d.weapon.magFamilies.join(', ')}</span><span class="muted">Loaded</span><span>${w.feed?.rounds ?? 0}${w.feed?.capacity ? ` / ${w.feed.capacity}${w.feed?.chamber ? ' +1' : ''}` : ''}</span>` : html`<span class="muted">Reach</span><span>${d.weapon.reach}</span><span class="muted">Parry</span><span>${d.weapon.parry}</span>`}
          <span class="muted">Condition</span><span>${w.cond ?? 100}%</span><span class="muted">Weight</span><span>${w.weight} kg</span>
        </div>
        ${(st.breakdown || []).length ? html`<h3 style=${{ marginTop: '8px' }}>Attachment effects</h3>${st.breakdown.map(b => html`<div class="small">${b.source}: ${b.stat === 'note' ? b.note : `${b.stat} ${signed(b.value)}`}</div>`)}` : null}
        <div class="tiny dim" style=${{ marginTop: '6px' }}>${d.weapon.notes || ''}</div>
      <//>
      <${Panel} title="Compatible parts you carry"><div class="col">${parts.filter(p => { const pd = M.def(v, p); return pd.magazine ? M.magFitsWeapon(pd, d) : d.weapon.mounts.some(m => M.attachFits(pd, m, d)); }).map(p => html`<div class="list-item" style=${{ cursor: 'grab' }} onContextMenu=${e => itemMenu(e, v, p, ctx)}>
        <div style=${{ position: 'relative', width: '90px', height: '40px', flex: 'none' }}><${ItemArt} v=${v} item=${p} w=${90} h=${40} /></div><span class="grow small">${M.itemName(v, p)}${M.def(v, p).magazine ? ` · ${M.roundCount(p.rounds)}/${M.def(v, p).magazine.capacity}` : ''}</span>
        <button class="small right" onClick=${() => run(M.def(v, p).magazine ? 'item.insertMag' : 'item.attach', M.def(v, p).magazine ? { weaponId: w.id, magId: p.id } : { weaponId: w.id, attId: p.id })}>${M.def(v, p).magazine ? 'Insert' : 'Install'}</button></div>`)}</div><//>
    </div>
  </div>`;
}
