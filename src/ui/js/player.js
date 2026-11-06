// Player pages: dashboard, trader, crafting & jobs.
import { html, useState, run, Panel, money, signed, fmtTime } from './ui.js';
import * as M from './model.js';
import { Vitals } from './combat.js';
import { EventFeed } from './events.js';
import { Grid, StorageView, CharacterInventory } from './inventory.js';

export function PlayerDashboard({ v, charId, go }) {
  const c = v.characters[charId];
  const mine = M.myChars(v);
  const shops = Object.values(v.traders || {});
  const jobs = Object.values(v.jobs || {}).filter(j => j.assigned.includes(charId) || j.status === 'open');
  const enc = M.activeEncounterFor(v, charId);
  return html`<div class="cols c3">
    <div class="col">
      ${c ? html`<${Panel} title=${c.name}><${Vitals} v=${v} c=${c} /><div class="row small" style=${{ marginTop: '8px' }}><span class="chip info">${v.settings?.ranks?.[c.rank - 1]?.name}</span><span>${money(c.session.money)}</span><span class="muted">${c.derived?.encumbrance} encumbrance</span></div><//>` : html`<${Panel} title="Welcome"><div class="muted">The GM has not assigned you a character yet.</div><//>`}
      ${mine.length > 1 ? html`<${Panel} title="Your characters">${mine.map(x => html`<div class="row small"><span class="grow">${x.name}</span><span>${x.session.hp}/${x.build?.hp} HP</span></div>`)}<//>` : null}
      <${Panel} title="Party">${Object.values(v.characters).filter(x => x.kind === 'pc' && !x.mine).map(x => html`<div class="row small"><span class="grow">${x.name}</span><span class="muted">${x.session.hp}/${x.build?.hp} HP</span></div>`)}<//>
    </div>
    <div class="col">
      ${enc ? html`<${Panel} title=${`Combat: ${enc.name}`} actions=${html`<button class="small primary" onClick=${() => go('combat')}>Open combat</button>`}><div>Round ${enc.round} · ${M.charName(v, enc.order[enc.turn])}'s turn</div><//>` : null}
      ${shops.length ? html`<${Panel} title="Open shops">${shops.map(t => html`<div class="row"><span class="grow">${t.name}</span><button class="small primary" onClick=${() => go('trader')}>Trade</button></div>`)}<//>` : null}
      <${Panel} title="Jobs">${jobs.map(j => html`<div class="small" style=${{ marginBottom: '6px' }}><b>${j.title}</b> <span class="chip">${j.status}</span><div class="muted">${j.employer}</div></div>`)}${!jobs.length ? html`<div class="muted">No jobs.</div>` : null}<//>
    </div>
    <${Panel} title="Recent activity"><div class="scroll h-md"><${EventFeed} v=${v} filter=${e => !charId || e.actorId === charId || e.targetId === charId || e.kind === 'request'} limit=${30} /></div>
      ${v.host?.notes?.length ? html`<h3 style=${{ marginTop: '8px' }}>Notices</h3>${v.host.notes.slice(-5).map(n => html`<div class="tiny muted">${fmtTime(n.at)} ${n.text}</div>`)}` : null}<//>
  </div>`;
}

export function PlayerTrader({ v, charId }) {
  const shops = Object.values(v.traders || {}).filter(t => !charId || !t.openFor?.length || t.openFor.includes(charId));
  const [sel, setSel] = useState(null);
  const t = shops.find(x => x.id === sel) || shops[0];
  if (!t) return html`<div class="empty">No trader is open for you. The GM opens shops during play.</div>`;
  return html`<div class="col">
    <div class="row">${shops.map(s => html`<button class=${s.id === t.id ? 'primary' : ''} onClick=${() => setSel(s.id)}>${s.name}</button>`)}<span class="right">${v.characters[charId]?.name}: <b>${money(v.characters[charId]?.session.money)}</b></span></div>
    <div class="cols" style=${{ gridTemplateColumns: 'auto 1fr' }}>
      <${Panel} title=${`${t.name} — stock`} actions=${html`<span class="muted small">Drag to your inventory or right-click → Buy · sells at ${Math.round(t.sellMult * 100)}% of value</span>`}>
        <div class="scroll" style=${{ maxHeight: 'calc(100vh - 230px)' }}><${StorageView} v=${v} parentRef=${'trader:' + t.id} ctx=${{ charId }} prices=${v.traderPrices} /></div>
        <div class="slot" style=${{ minHeight: '50px', marginTop: '8px' }} data-drop="trader-sell" data-trader=${t.id}><span class="lbl">Sell</span><span class="dim small">Drop your items here to sell</span></div>
      <//>
      <div><${CharacterInventory} v=${v} charId=${charId} traderId=${t.id} /></div>
    </div>
  </div>`;
}

export function PlayerCrafting({ v, charId }) {
  const recipes = Object.values(v.recipes || {});
  const [target, setTarget] = useState('');
  const jobs = Object.values(v.jobs || {});
  const owned = charId ? M.owned(v, charId) : [];
  return html`<div class="cols c2">
    <${Panel} title="Crafting">${!v.settings?.rules?.crafting ? html`<div class="muted">Crafting is disabled in this campaign.</div>` : recipes.map(r => {
      const st = v.recipeStatus?.[`${r.id}:${charId}`];
      return html`<div class="panel recipe ${st?.ok ? 'ok' : 'no'}" style=${{ marginBottom: '8px' }}><div class="body">
        <div class="row"><b class="grow">${r.name}</b>${r.time ? html`<span class="chip">${r.time}</span>` : null}${r.skill ? html`<span class="chip info">${r.skill.name}${r.skill.mod ? ` ${signed(r.skill.mod)}` : ''}${st?.skill?.effective !== undefined ? ` → ${st.skill.effective ?? '—'}` : ''}</span>` : null}</div>
        <div class="small">${(st?.inputs || r.inputs).map(x => html`<span class=${x.have >= x.qty ? 'good' : 'bad'}>${x.qty} × ${x.name || v.defs[x.defId]?.name} (${x.have ?? 0}) </span>`)}${(st?.tools || []).map(t => html`<span class=${t.have ? 'good' : 'bad'}>· tool: ${t.name} </span>`)}</div>
        <div class="row small" style=${{ marginTop: '4px' }}>${r.output ? html`<span>→ ${r.output.qty} × ${v.defs[r.output.defId]?.name}</span>` : html`<span>→ repair (+${r.repair?.amount}% condition)</span>
          <select value=${target} onChange=${e => setTarget(e.target.value)}><option value="">Choose item…</option>${owned.filter(i => !r.repair?.categories?.length || r.repair.categories.includes(M.def(v, i)?.category)).map(i => html`<option value=${i.id}>${M.itemName(v, i)} (${i.cond ?? 100}%)</option>`)}</select>`}
          <button class="primary right" disabled=${!st?.ok || (r.repair && !target)} onClick=${() => run('craft.make', { charId, recipeId: r.id, targetItemId: target || undefined }, { ok: true })}>Craft</button></div>
        ${r.notes ? html`<div class="tiny dim">${r.notes}</div>` : null}</div></div>`;
    })}<//>
    <${Panel} title="Jobs & missions">${jobs.map(j => html`<div class="panel" style=${{ marginBottom: '8px' }}><div class="body"><div class="row"><b class="grow">${j.title}</b><span class="chip ${j.status === 'completed' ? 'good' : j.status === 'failed' ? 'bad' : 'info'}">${j.status}</span></div>
      <div class="small muted">${j.employer}</div><p class="small" style=${{ whiteSpace: 'pre-wrap' }}>${j.description}</p>
      ${j.objectives.map(o => html`<div class="small">${o.done ? '☑' : '☐'} ${o.text}</div>`)}
      <div class="small">Reward: ${money(j.reward.money)}${j.reward.split === 'split' ? ' (split)' : ' each'}${j.paid ? ' · paid' : ''}</div>
      <div class="small muted">Assigned: ${j.assigned.map(id => M.charName(v, id)).join(', ') || 'nobody'}</div></div></div>`)}${!jobs.length ? html`<div class="muted">No jobs available.</div>` : null}<//>
  </div>`;
}
