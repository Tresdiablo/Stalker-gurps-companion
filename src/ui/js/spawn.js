// GM item spawning: one searchable picker used everywhere ("G" opens it for the current target).
import { html, useState, useEffect, useRef, run, openModal, Modal, toast } from './ui.js';
import * as M from './model.js';

/** Remembered spawn target for this window (character / stash / trader reference). */
let lastTarget = null;
export function setSpawnTarget(ref) { if (ref) lastTarget = ref; }
export function getSpawnTarget() { return lastTarget; }

/** Every place an item can be spawned, active-encounter combatants first. */
export function spawnTargets(v) {
  const enc = Object.values(v.encounters || {}).find(e => e.status === 'active');
  const inEnc = new Set(enc ? enc.order : []);
  const chars = Object.values(v.characters).filter(c => !c.archived);
  const sortC = (a, b) => (inEnc.has(b.id) - inEnc.has(a.id)) || (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'pc' ? -1 : 1);
  return [
    ...chars.sort(sortC).map(c => ({ ref: 'char:' + c.id, label: c.name, group: inEnc.has(c.id) ? `In combat: ${enc.name}` : c.kind === 'pc' ? 'Player characters' : 'NPCs' })),
    ...Object.values(v.stashes || {}).map(s => ({ ref: 'stash:' + s.id, label: s.name, group: 'Stashes & containers' })),
    ...Object.values(v.traders || {}).map(t => ({ ref: 'trader:' + t.id, label: t.name, group: 'Traders' })),
  ];
}

export function targetLabel(v, ref) {
  if (!ref) return '—';
  const [k, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  return ({ char: v.characters, stash: v.stashes, trader: v.traders }[k]?.[id]?.name) || '—';
}

export function TargetSelect({ v, value, onChange, cls = '' }) {
  const list = spawnTargets(v);
  const groups = [...new Set(list.map(t => t.group))];
  return html`<select class=${cls} value=${value || ''} onChange=${e => onChange(e.target.value)}>
    <option value="">Choose who receives it…</option>
    ${groups.map(g => html`<optgroup label=${g}>${list.filter(t => t.group === g).map(t => html`<option value=${t.ref}>${t.label}</option>`)}</optgroup>`)}
  </select>`;
}

/** Spawn an item; magazines and internal-feed weapons can come loaded. */
export async function spawnItem(v, defId, to, { qty = 1, loaded = false } = {}) {
  if (!to) { toast('Choose who receives the item first.', 'error'); return null; }
  setSpawnTarget(to);
  const d = v.defs[defId];
  const r = await run('item.spawn', { defId, qty, to, loadFull: loaded && !!(d?.magazine || d?.weapon?.integral) });
  if (r) toast(`${qty > 1 ? qty + ' × ' : ''}${d?.name} → ${targetLabel(v, to)}${r.result?.ids?.length ? '' : ' (merged into a stack)'}`, 'ok');
  return r;
}

/** Open the picker. `to` preselects the receiver. */
export function openSpawn(v, to) {
  return openModal(close => html`<${SpawnPicker} v=${v} initialTo=${to || lastTarget} close=${close} />`);
}

function SpawnPicker({ v, initialTo, close }) {
  const [q, setQ] = useState('');
  const [to, setTo] = useState(initialTo || '');
  const [qty, setQty] = useState(1);
  const [loaded, setLoaded] = useState(true);
  const [cat, setCat] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef();
  useEffect(() => { input.current?.focus(); }, []);
  const defs = Object.values(v.defs).filter(d => (!cat || d.category === cat) && `${d.name} ${d.sub} ${d.category}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
  const go = async (d, keepOpen) => { const r = await spawnItem(v, d.id, to, { qty: Math.max(1, Number(qty) || 1), loaded }); if (r && !keepOpen) close(true); };
  const key = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(i => Math.min(defs.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter' && defs[sel]) { e.preventDefault(); go(defs[sel], e.shiftKey); }
  };
  const cats = [...new Set(Object.values(v.defs).map(d => d.category))].sort();
  return html`<${Modal} title="Spawn item" wide=${true} footer=${html`<span class="tiny dim grow">Enter = spawn and close · Shift+Enter = spawn and keep open · ↑↓ choose</span><button onClick=${() => close(null)}>Close</button>`}>
    <div class="col">
      <div class="row"><b>Give to</b><${TargetSelect} v=${v} value=${to} onChange=${setTo} cls="grow" /></div>
      <div class="row">
        <input ref=${input} class="grow" placeholder="Search the catalog…" value=${q} onInput=${e => { setQ(e.target.value); setSel(0); }} onKeyDown=${key} />
        <select value=${cat} onChange=${e => { setCat(e.target.value); setSel(0); }}><option value="">All</option>${cats.map(c => html`<option value=${c}>${c}</option>`)}</select>
        <label class="row small">Qty <input type="number" min="1" max="10000" value=${qty} onInput=${e => setQty(e.target.value)} onKeyDown=${key} /></label>
        <label class="row small" title="Magazines and tube/internal-magazine weapons arrive full of compatible ammunition"><input type="checkbox" checked=${loaded} onChange=${e => setLoaded(e.target.checked)} /> Loaded</label>
      </div>
      <div class="scroll" style=${{ maxHeight: '48vh' }}>
        ${defs.map((d, i) => html`<div class="list-item ${i === sel ? 'sel' : ''}" onMouseEnter=${() => setSel(i)} onClick=${e => go(d, e.shiftKey)}>
          ${M.imageUrl(v, d.image) ? html`<img src=${M.imageUrl(v, d.image)} style=${{ width: '64px', height: '30px', objectFit: 'contain' }} />` : html`<span style=${{ width: '64px' }} class="dim tiny">${d.w}×${d.h}</span>`}
          <span class="grow">${d.name}<br /><span class="tiny dim">${d.sub || d.category}${d.stack > 1 ? ` · stacks of ${d.stack}` : ''}</span></span><span class="tiny dim">${d.value} ₽</span></div>`)}
        ${!defs.length ? html`<div class="empty">${Object.keys(v.defs).length ? 'No matching items.' : 'The catalog is empty — create items in the Item Catalog first.'}</div>` : null}
      </div>
    </div>
  <//>`;
}
