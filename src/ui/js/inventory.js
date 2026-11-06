// Tarkov-style inventory: grids, equipment slots, layered weapon art, drag-and-drop and
// context menus. One component set serves characters, NPCs, stashes, traders and containers.
import { html, useState, useEffect, useRef, openMenu, run, toast, askNumber, openModal, Modal, money, tipProps, FloatWin } from './ui.js';
import { conn } from './net.js';
import * as M from './model.js';

/* ================================================================ artwork */
const natural = new Map(); // url -> {w,h}
const naturalWaiters = new Set();
function measure(url) {
  if (!url || natural.has(url)) return natural.get(url);
  natural.set(url, null);
  const img = new Image();
  img.onload = () => { natural.set(url, { w: img.naturalWidth, h: img.naturalHeight }); for (const f of naturalWaiters) f(); };
  img.onerror = () => natural.set(url, { w: 1, h: 1, broken: true });
  img.src = url;
  return null;
}
function useNatural(urls) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(x => x + 1); naturalWaiters.add(f); return () => naturalWaiters.delete(f); }, []);
  return urls.map(u => (u ? measure(u) : null));
}

const ABBR = { optic: 'OPT', muzzle: 'MZL', foregrip: 'GRP', underbarrel: 'UB', stock: 'STK', side: 'TAC', magazine: 'MAG', other: 'ATT' };

/**
 * Layered weapon/item artwork. Base image + attachment overlays at the weapon's mount anchors.
 * Priority: layered (all installed parts have art) → matching preconfigured variant → base image.
 * Rotation rotates the whole assembly. Original image files are never modified.
 */
export function ItemArt({ v, item, w, h, rotated }) {
  const d = M.def(v, item);
  const parts = d?.weapon ? Object.entries(M.installed(v, item)).map(([mount, att]) => ({ mount: d.weapon.mounts.find(m => m.id === mount), att, ad: M.def(v, att) })).filter(p => p.mount && p.ad) : [];
  let baseRef = d?.image || '';
  const layered = parts.filter(p => p.ad.attachment?.art?.image || (p.mount.slot === 'magazine' && p.ad.image));
  const missingArt = parts.filter(p => !layered.includes(p));
  if (missingArt.length && d?.variants?.length) {
    const ids = Object.fromEntries(parts.map(p => [p.mount.id, p.att.defId]));
    const variant = d.variants.find(x => Object.entries(x.requires || {}).every(([m, id]) => ids[m] === id));
    if (variant) { baseRef = variant.image; layered.length = 0; }
  }
  const baseUrl = M.imageUrl(v, baseRef);
  const overlayUrls = layered.map(p => M.imageUrl(v, p.ad.attachment?.art?.image || p.ad.image));
  const [bn, ...on] = useNatural([baseUrl, ...overlayUrls]);
  const boxW = rotated ? h : w, boxH = rotated ? w : h; // draw unrotated, then rotate the stage
  const noArt = !baseUrl || bn?.broken;
  if (noArt && !layered.length) {
    return html`<div class="art"><span class="fallback">${(d?.name || '?').slice(0, 3).toUpperCase()}</span></div>`;
  }
  // without a base image, draw a neutral silhouette sized to the item's cell ratio so attachments still layer
  const aspect = noArt ? (d.w / d.h) * 2.2 : bn ? bn.w / bn.h : boxW / boxH;
  const pad = 4;
  let sw = boxW - pad * 2, sh = sw / aspect;
  if (sh > boxH - pad * 2) { sh = boxH - pad * 2; sw = sh * aspect; }
  const crop = v.assets?.[baseRef]?.crop;
  const style = { width: sw + 'px', height: sh + 'px', transform: rotated ? 'rotate(-90deg)' : 'none' };
  return html`<div class="art"><div class="stage" style=${style}>
    ${noArt ? html`<div style=${{ position: 'absolute', inset: '22% 0 28% 0', background: 'linear-gradient(#3a4650, #2a333b)', borderRadius: '4px', border: '1px solid #56636e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#9aa9b4' }}>${d?.name}</div>` : html`<img class="base" src=${baseUrl} draggable="false" style=${crop ? { objectViewBox: `inset(${crop.y}% ${100 - crop.x - crop.w}% ${100 - crop.y - crop.h}% ${crop.x}%)` } : null} />`}
    ${layered.map((p, i) => {
      const n = on[i]; if (!n || n.broken) return null;
      const art = p.ad.attachment?.art || { anchorX: 0.5, anchorY: 0.5, scale: 1 };
      const off = p.mount.offsets?.[p.att.defId] || {};
      const ow = sw * (p.mount.scale || 0.2) * (art.scale || 1) * (off.scale || 1);
      const oh = ow * n.h / n.w;
      const ax = art.anchorX ?? 0.5, ay = art.anchorY ?? 0.5;
      const left = (p.mount.x + (off.x || 0)) * sw - ax * ow, top = (p.mount.y + (off.y || 0)) * sh - ay * oh;
      return html`<img src=${overlayUrls[i]} draggable="false" style=${{ left: left + 'px', top: top + 'px', width: ow + 'px', height: oh + 'px', zIndex: (p.mount.z ?? 1) + 1, transform: `rotate(${(p.mount.rot || 0) + (off.rot || 0)}deg)`, transformOrigin: `${ax * 100}% ${ay * 100}%` }} />`;
    })}
  </div></div>`;
}

/* ================================================================ tiles */
function tileTip(v, it) {
  const d = M.def(v, it); if (!d) return '';
  const lines = [`${M.itemName(v, it)} — ${d.sub || d.category}`, `${d.w}×${d.h} cells · ${it.weight ?? d.weight} kg${it.qty > 1 ? ` · ${it.qty}/${d.stack}` : ''}${it.cond !== undefined && it.cond < 100 ? ` · condition ${it.cond}%` : ''}`];
  if (d.weapon) { const w = d.weapon; lines.push(`${w.skill} · ${w.damage}${w.kind === 'ranged' ? ` · Acc ${it.stats?.acc ?? w.acc}${it.stats?.scope ? `+${it.stats.scope}` : ''} · RoF ${w.rof} · Rcl ${it.stats?.rcl ?? w.rcl} · Range ${w.range || '?'}` : ` · Reach ${w.reach || ''}`}`); if (it.feed) lines.push(`Loaded: ${it.feed.rounds}${it.feed.capacity ? ` / ${it.feed.capacity}${it.feed.chamber ? ' (+1 chambered)' : ''}` : ''}`); for (const b of it.stats?.breakdown || []) lines.push(`  ${b.source}: ${b.stat === 'note' ? b.note : `${b.stat} ${b.value > 0 ? '+' : ''}${b.value}`}`); }
  if (d.magazine) { lines.push(`Magazine · ${d.magazine.family} · ${M.roundCount(it.rounds)}/${d.magazine.capacity}`); for (const [a, n] of it.rounds || []) lines.push(`  ${n} × ${v.defs[a]?.name || a}`); }
  if (d.ammo) lines.push(`Caliber ${d.ammo.caliber}${d.ammo.divisor ? ` · armor divisor (${d.ammo.divisor})` : ''}${d.ammo.woundShift ? ` · wounding ${d.ammo.woundShift > 0 ? '+' : ''}${d.ammo.woundShift} size` : ''}${d.ammo.projectiles ? ` · ${d.ammo.projectiles} projectiles` : ''}`);
  if (d.armor) lines.push(`DR ${d.armor.dr} · ${d.armor.locations.join(', ')}${d.armor.flexible ? ' · flexible' : ''}${it.dp !== undefined && d.armor.dpMax ? ` · DP ${it.dp}/${d.armor.dpMax}` : ''}`);
  if (d.container) lines.push(`Storage: ${d.container.grids.map(g => `${g.w}×${g.h}`).join(' + ')}`);
  if (d.description) lines.push('', d.description.slice(0, 300));
  return lines.join('\n');
}

export function Tile({ v, it, ctx, style, inSlot, price }) {
  const d = M.def(v, it);
  const fp = M.footprint(v, it, inSlot ? 0 : undefined);
  const cell = cellPx();
  const w = fp.w * cell - 2, h = fp.h * cell - 2;
  const rotated = !inSlot && !!it.loc?.r;
  const badges = d?.weapon ? Object.entries(M.installed(v, it)).map(([m, a]) => d.weapon.mounts.find(x => x.id === m)?.slot).filter(s => s && s !== 'magazine').map(s => ABBR[s] || 'ATT') : [];
  const isSel = selection.id === it.id;
  const attrs = {
    class: `tile cat-${d?.category || 'misc'} ${isSel ? 'sel' : ''} ${it.hidden ? 'hidden-item' : ''}`,
    style: inSlot ? null : { left: it.loc.x * cell + 1 + 'px', top: it.loc.y * cell + 1 + 'px', width: w + 'px', height: h + 'px', ...style },
    'data-drop': 'item', 'data-item': it.id,
    onPointerDown: e => startDrag(e, v, it, ctx),
    onContextMenu: e => itemMenu(e, v, it, ctx),
    onDblClick: () => (d?.container ? ctx.openContainer?.(it.id) : inspect(v, it)),
    ...tipProps(tileTip(v, it)),
  };
  return html`<div ...${attrs}>
    <${ItemArt} v=${v} item=${it} w=${inSlot ? 140 : w} h=${inSlot ? 56 : h} rotated=${rotated} />
    <span class="name">${M.itemName(v, it)}</span>
    ${it.cond !== undefined && it.cond < 100 ? html`<span class="cond">${it.cond}%</span>` : null}
    ${badges.length ? html`<span class="badges">${badges.map(b => html`<span>${b}</span>`)}</span>` : null}
    ${price !== undefined ? html`<span class="price">${money(price)}</span>` : d?.stack > 1 ? html`<span class="qty">${it.qty}</span>` : null}
    ${d?.magazine || d?.weapon?.integral ? html`<span class="rounds">${M.roundCount(it.rounds)}/${d.magazine?.capacity || d.weapon.integral.capacity}</span>` : d?.weapon?.kind === 'ranged' && it.feed ? html`<span class="rounds">${it.feed.rounds}</span>` : null}
  </div>`;
}

let cellCache = 0;
export function cellPx() { if (!cellCache) cellCache = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell')) || 46; return cellCache; }

/* ================================================================ grid */
export function Grid({ v, parentRef, grid, ctx, prices }) {
  const cell = cellPx();
  const items = M.children(v, parentRef).filter(i => i.loc.g === grid.id && !ctx.filter?.(i));
  return html`<div>
    ${grid.label ? html`<div class="grid-label row">${grid.label} <span class="dim">${grid.w}×${grid.h}${grid.accepts?.length ? ` · ${grid.accepts.join(', ')} only` : ''}</span>${grid.w * grid.h > 4 ? html`<button class="small ghost right" title="Merge stacks and pack items" onClick=${() => run('item.sortGrid', { ref: parentRef, grid: grid.id })}>Sort</button>` : null}</div>` : null}
    <div class="grid" data-drop="grid" data-ref=${parentRef} data-grid=${grid.id} data-w=${grid.w} data-h=${grid.h} style=${{ width: grid.w * cell + 'px', height: grid.h * cell + 'px' }}>
      ${(grid.compartments || []).map(c => html`<div class="comp" style=${{ left: c.x * cell + 'px', top: c.y * cell + 'px', width: c.w * cell + 'px', height: c.h * cell + 'px' }}></div>`)}
      ${items.map(it => html`<${Tile} key=${it.id} v=${v} it=${it} ctx=${ctx} price=${prices?.[it.id]} />`)}
    </div></div>`;
}

export function Slot({ v, charId, slot, label, ctx, cls = '' }) {
  const it = M.equippedIn(v, charId, slot);
  return html`<div class="slot ${cls}" data-drop="slot" data-ref=${'char:' + charId} data-slot=${slot}>
    <span class="lbl">${label}</span>${it ? html`<${Tile} v=${v} it=${it} ctx=${ctx} inSlot=${true} />` : html`<span class="dim tiny">empty</span>`}</div>`;
}

/* ================================================================ drag and drop */
const selection = { id: null };
let drag = null;

function startDrag(e, v, it, ctx) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const cell = cellPx();
  drag = { v, it, ctx, el, sx: e.clientX, sy: e.clientY, offX: e.clientX - rect.left, offY: e.clientY - rect.top, started: false, r: !!it.loc?.r, ghost: null, preview: null, target: null, cell };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
  window.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (!drag?.started) return;
  if (e.key === 'r' || e.key === 'R') { drag.r = !drag.r; const t = drag.offX; drag.offX = drag.offY; drag.offY = t; drag.ghost.style.transform = drag.r !== !!drag.it.loc?.r ? 'rotate(90deg)' : 'none'; onMove(drag.lastEv); }
  if (e.key === 'Escape') cancelDrag();
}

function onMove(e) {
  if (!drag || !e) return;
  drag.lastEv = e;
  if (!drag.started) {
    if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 5) return;
    drag.started = true;
    const g = drag.el.cloneNode(true);
    g.classList.add('drag-ghost');
    const r = drag.el.getBoundingClientRect();
    g.style.width = r.width + 'px'; g.style.height = r.height + 'px'; g.style.left = '0'; g.style.top = '0';
    document.body.appendChild(g); drag.ghost = g;
    drag.el.style.opacity = '0.35';
  }
  drag.ghost.style.left = e.clientX - drag.offX + 'px';
  drag.ghost.style.top = e.clientY - drag.offY + 'px';
  const under = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.dataset?.drop && n !== drag.el && !drag.el.contains(n));
  clearPreview();
  drag.target = null;
  if (!under) return;
  const kind = under.dataset.drop;
  if (kind === 'grid') {
    const rect = under.getBoundingClientRect();
    const cw = rect.width / Number(under.dataset.w);
    const fp = M.footprint(drag.v, drag.it, drag.r);
    const x = Math.round((e.clientX - drag.offX - rect.left) / cw), y = Math.round((e.clientY - drag.offY - rect.top) / cw);
    const ok = M.canPlaceGrid(drag.v, drag.it, under.dataset.ref, under.dataset.grid, x, y, drag.r);
    const p = document.createElement('div');
    p.className = 'preview ' + (ok ? 'ok' : 'bad');
    Object.assign(p.style, { left: x * cw + 'px', top: y * cw + 'px', width: fp.w * cw + 'px', height: fp.h * cw + 'px' });
    under.appendChild(p); drag.preview = p;
    drag.target = { kind, ref: under.dataset.ref, grid: under.dataset.grid, x, y, r: drag.r ? 1 : 0, ok };
  } else if (kind === 'slot') {
    const d = M.def(drag.v, drag.it);
    const ok = M.slotsFor(d).includes(under.dataset.slot);
    under.classList.add(ok ? 'hover-ok' : 'hover-bad'); drag.hoverEl = under;
    drag.target = { kind, ref: under.dataset.ref, slot: under.dataset.slot, ok };
  } else if (kind === 'mount') {
    under.classList.add('hover-ok'); drag.hoverEl = under;
    drag.target = { kind, weapon: under.dataset.weapon, mount: under.dataset.mount };
  } else if (kind === 'item') {
    under.classList.add('sel'); drag.hoverEl = under;
    drag.target = { kind, itemId: under.dataset.item };
  } else if (kind === 'trader-sell') {
    under.classList.add('hover-ok'); drag.hoverEl = under;
    drag.target = { kind, traderId: under.dataset.trader };
  }
}

function clearPreview() {
  if (drag?.preview) { drag.preview.remove(); drag.preview = null; }
  if (drag?.hoverEl) { drag.hoverEl.classList.remove('hover-ok', 'hover-bad'); if (drag.hoverEl.classList.contains('tile')) drag.hoverEl.classList.remove('sel'); drag.hoverEl = null; }
}
function cancelDrag() {
  if (!drag) return;
  clearPreview();
  drag.ghost?.remove();
  if (drag.el) drag.el.style.opacity = '';
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('keydown', onKey);
  drag = null;
}

async function onUp() {
  const d = drag;
  if (!d) return;
  const t = d.target, wasStarted = d.started;
  cancelDrag();
  if (!wasStarted) { selection.id = d.it.id; d.ctx.select?.(d.it.id); return; }
  if (!t) return;
  await dropAction(d.v, d.it, t, d.ctx);
}

/** Decide what a drop means. */
async function dropAction(v, it, t, ctx) {
  const from = M.rootOf(v, it);
  const fromTrader = from?.startsWith('trader:');
  if (t.kind === 'grid') {
    if (fromTrader && !t.ref.startsWith('trader:')) return buyItem(v, it, ctx);
    if (!fromTrader && t.ref.startsWith('trader:') && v.role !== 'gm') return sellItem(v, it, t.ref.slice(7), ctx);
    return run('item.move', { itemId: it.id, target: { p: t.ref, g: t.grid, x: t.x, y: t.y, r: t.r } });
  }
  if (t.kind === 'slot') { if (fromTrader) return buyItem(v, it, ctx); return run('item.move', { itemId: it.id, target: { p: t.ref, slot: t.slot } }); }
  if (t.kind === 'mount') return run('item.move', { itemId: it.id, target: { p: 'item:' + t.weapon, mount: t.mount } });
  if (t.kind === 'trader-sell') return sellItem(v, it, t.traderId, ctx);
  if (t.kind === 'item') {
    const target = v.items[t.itemId]; if (!target || target.id === it.id) return;
    const sd = M.def(v, it), td = M.def(v, target);
    if (fromTrader) return buyItem(v, it, ctx);
    if (sd?.ammo && (td?.magazine || td?.weapon?.integral)) return run('item.load', { holderId: target.id, ammoId: it.id });
    if (sd?.ammo && td?.weapon && it.defId) { const mag = target.feed?.magazineId && v.items[target.feed.magazineId]; if (mag) return run('item.load', { holderId: mag.id, ammoId: it.id }); }
    if (it.defId === target.defId && sd?.stack > 1) return run('item.merge', { srcId: it.id, dstId: target.id });
    if (sd?.magazine && td?.weapon) return run('item.insertMag', { weaponId: target.id, magId: it.id });
    if (sd?.attachment && td?.weapon) return run('item.attach', { weaponId: target.id, attId: it.id });
    if (td?.container) return run('item.transfer', { itemId: it.id, to: 'item:' + target.id });
    toast('Those items do not combine.', 'error');
  }
}

async function buyItem(v, it, ctx) {
  const t = v.traders[M.rootOf(v, it).slice(7)];
  const charId = ctx.charId;
  if (!charId) return toast('Choose a character first.', 'error');
  const d = M.def(v, it);
  let qty = it.qty;
  if (it.qty > 1) { qty = await askNumber(`Buy ${d.name}`, { value: it.qty, max: it.qty, label: `Quantity (${money(Math.round((v.traderPrices[it.id] || 0) / it.qty))} each)` }); if (!qty) return; }
  return run('trader.buy', { traderId: t.id, charId, itemId: it.id, qty }, { ok: true });
}
async function sellItem(v, it, traderId, ctx) {
  const d = M.def(v, it);
  let qty = it.qty;
  if (it.qty > 1) { qty = await askNumber(`Sell ${d.name}`, { value: it.qty, max: it.qty }); if (!qty) return; }
  return run('trader.sell', { traderId, charId: ctx.charId, itemId: it.id, qty }, { ok: true });
}

/* ================================================================ context menu */
export function itemMenu(e, v, it, ctx) {
  const d = M.def(v, it); if (!d) return;
  const gm = v.role === 'gm';
  const root = M.rootOf(v, it);
  const charId = root?.startsWith('char:') ? root.slice(5) : ctx.charId;
  const inTrader = root?.startsWith('trader:');
  const mine = (root?.startsWith('char:') && (gm || v.characters[root.slice(5)]?.mine));
  const ownerItems = charId ? M.owned(v, charId) : [];
  const items = [{ header: M.itemName(v, it) }];
  if (inTrader && !gm) {
    items.push({ label: `Buy (${money(v.traderPrices[it.id])})`, onClick: () => buyItem(v, it, ctx) }, { label: 'Inspect', onClick: () => inspect(v, it) });
    return openMenu(e, items);
  }
  items.push({ label: 'Inspect', hint: 'dbl-click', onClick: () => inspect(v, it) });
  if (d.container) items.push({ label: 'Open', onClick: () => ctx.openContainer?.(it.id) });
  if (d.consumable && mine) items.push({ label: 'Use', onClick: () => run('item.use', { itemId: it.id }, { ok: true }) });
  // magazine / integral feed actions
  if (d.magazine || d.weapon?.integral) {
    const stacks = ownerItems.filter(a => M.ammoFitsHolder(v, M.def(v, a), d));
    const byDef = {};
    for (const a of stacks) (byDef[a.defId] = byDef[a.defId] || []).push(a);
    items.push('-', { label: 'Load compatible ammo', sub: Object.entries(byDef).map(([defId, list]) => ({ label: `${v.defs[defId].name} (${list.reduce((x, y) => x + y.qty, 0)})`, onClick: () => run('item.quickLoad', { holderId: it.id, ammoDefId: defId }) })) });
    items.push({ label: 'Quick load (fill)', hint: 'Q', disabled: !stacks.length, onClick: () => run('item.quickLoad', { holderId: it.id }) });
    items.push({ label: 'Unload ammo', disabled: !M.roundCount(it.rounds), onClick: () => run('item.unload', { holderId: it.id }) });
    if (d.magazine) {
      const weaponsOwned = ownerItems.filter(w => M.magFitsWeapon(d, M.def(v, w)) && !M.installed(v, w).magwell);
      items.push({ label: 'Insert into weapon', sub: weaponsOwned.map(w => ({ label: M.itemName(v, w), onClick: () => run('item.insertMag', { weaponId: w.id, magId: it.id }) })) });
    }
  }
  if (d.weapon?.kind === 'ranged' && !d.weapon.integral) {
    const mag = it.feed?.magazineId ? v.items[it.feed.magazineId] : null;
    const mags = ownerItems.filter(m => M.magFitsWeapon(M.def(v, m), d) && m.loc.mount === undefined).sort((a, b) => M.roundCount(b.rounds) - M.roundCount(a.rounds));
    items.push('-', { label: mag ? 'Swap magazine' : 'Insert magazine', sub: mags.map(m => ({ label: `${M.itemName(v, m)} (${M.roundCount(m.rounds)}/${M.def(v, m).magazine.capacity})`, onClick: async () => { if (mag) { const r = await run('item.ejectMag', { weaponId: it.id }); if (!r) return; } run('item.insertMag', { weaponId: it.id, magId: m.id }); } })) });
    items.push({ label: 'Eject magazine', disabled: !mag, onClick: () => run('item.ejectMag', { weaponId: it.id }) });
    items.push({ label: 'Chamber a round', disabled: !!it.feed?.chamber || !mag, onClick: () => run('item.chamber', { weaponId: it.id }) });
  }
  if (d.weapon) {
    const inst = M.installed(v, it);
    const mounts = d.weapon.mounts.filter(m => m.slot !== 'magazine');
    const atts = ownerItems.filter(a => M.def(v, a)?.attachment && a.loc.mount === undefined);
    const installable = [];
    for (const m of mounts) if (!inst[m.id]) for (const a of atts) if (M.attachFits(M.def(v, a), m, d)) installable.push({ label: `${M.itemName(v, a)} → ${m.label}`, onClick: () => run('item.attach', { weaponId: it.id, attId: a.id, mountId: m.id }) });
    items.push({ label: 'Install attachment', sub: installable });
    items.push({ label: 'Remove attachment', sub: Object.entries(inst).filter(([m]) => mounts.some(x => x.id === m)).map(([m, a]) => ({ label: `${M.itemName(v, a)} (${mounts.find(x => x.id === m).label})`, onClick: () => run('item.detach', { weaponId: it.id, mountId: m }) })) });
    if (ctx.customize) items.push({ label: 'Customize…', onClick: () => ctx.customize(it.id) });
  }
  if (d.ammo) {
    const holders = ownerItems.filter(h => (M.def(v, h)?.magazine || M.def(v, h)?.weapon?.integral) && M.ammoFitsHolder(v, d, M.def(v, h)));
    items.push('-', { label: 'Load into', sub: holders.map(h => ({ label: `${M.itemName(v, h)} (${M.roundCount(h.rounds)})`, onClick: () => run('item.load', { holderId: h.id, ammoId: it.id }) })) });
  }
  items.push('-');
  if (charId) {
    const slots = M.slotsFor(d).filter(s => !M.equippedIn(v, charId, s));
    if (it.loc?.slot === undefined) items.push({ label: 'Equip', sub: slots.map(s => ({ label: M.SLOTS.find(x => x[0] === s)?.[1] || s, onClick: () => run('item.move', { itemId: it.id, target: { p: 'char:' + charId, slot: s } }) })) });
    else items.push({ label: 'Unequip', onClick: () => run('item.transfer', { itemId: it.id, to: 'char:' + charId }) });
  }
  if (it.loc?.g !== undefined) items.push({ label: 'Rotate', hint: 'R', onClick: () => run('item.rotate', { itemId: it.id }) });
  if (it.qty > 1) items.push({ label: 'Split stack…', onClick: async () => { const n = await askNumber('Split stack', { value: Math.floor(it.qty / 2), max: it.qty - 1 }); if (n) run('item.split', { itemId: it.id, qty: n }); } });
  items.push({ label: 'Transfer to', sub: transferTargets(v, it, charId, gm) });
  if (root?.startsWith('char:') && it.loc?.g !== 'ground') items.push({ label: 'Drop on ground', onClick: () => run('item.drop', { itemId: it.id }) });
  if (ctx.traderId && !gm && mine) items.push({ label: `Sell to ${v.traders[ctx.traderId]?.name}`, onClick: () => sellItem(v, it, ctx.traderId, ctx) });
  if (gm) {
    items.push('-', { header: 'GM' });
    items.push({ label: 'Edit instance…', onClick: () => editInstance(v, it) });
    items.push({ label: it.hidden ? 'Reveal to players' : 'Hide from players', onClick: () => run('item.update', { itemId: it.id, hidden: !it.hidden }) });
    if (inTrader) items.push({ label: 'Set price…', onClick: async () => { const n = await askNumber('Price override (₽, total)', { value: v.traderPrices[it.id] || 0, min: 0, max: 100000000 }); if (n !== null) run('trader.setPrice', { id: root.slice(7), itemId: it.id, price: n }); } });
    items.push({ label: 'Delete (to trash)', onClick: () => run('item.delete', { itemId: it.id }) });
  }
  openMenu(e, items);
}

function transferTargets(v, it, charId, gm) {
  const out = [];
  const cur = M.rootOf(v, it);
  const chars = Object.values(v.characters).filter(c => gm ? true : c.mine);
  for (const c of chars) if ('char:' + c.id !== cur || it.loc?.g === 'ground') out.push({ label: c.name, onClick: () => run('item.transfer', { itemId: it.id, to: 'char:' + c.id }) });
  for (const s of Object.values(v.stashes || {})) if ('stash:' + s.id !== cur) out.push({ label: `Stash: ${s.name}`, onClick: () => run('item.transfer', { itemId: it.id, to: 'stash:' + s.id }) });
  if (charId) for (const ct of M.owned(v, charId).filter(x => M.def(v, x)?.container && x.id !== it.id)) out.push({ label: `Into ${M.itemName(v, ct)}`, onClick: () => run('item.transfer', { itemId: it.id, to: 'item:' + ct.id }) });
  if (gm) for (const t of Object.values(v.traders || {})) if ('trader:' + t.id !== cur) out.push({ label: `Trader: ${t.name}`, onClick: () => run('item.transfer', { itemId: it.id, to: 'trader:' + t.id }) });
  return out;
}

async function editInstance(v, it) {
  const d = M.def(v, it);
  const r = await openModal(close => html`<${EditInstance} v=${v} it=${it} d=${d} close=${close} />`);
  if (r) run('item.update', { itemId: it.id, ...r });
}
function EditInstance({ it, d, close }) {
  const [f, setF] = useState({ name: it.name || '', cond: it.cond ?? 100, qty: it.qty, dp: it.dp ?? '', notes: it.notes || '' });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return html`<${Modal} title=${`Edit ${d.name}`} footer=${html`<button onClick=${() => close(null)}>Cancel</button><button class="primary" onClick=${() => close({ name: f.name, cond: Number(f.cond), qty: Number(f.qty), ...(f.dp !== '' ? { dp: Number(f.dp) } : {}), notes: f.notes })}>Save</button>`}>
    <div class="form"><label class="field">Custom name<input value=${f.name} onInput=${set('name')} /></label><label class="field">Condition %<input type="number" value=${f.cond} onInput=${set('cond')} /></label>
    ${d.stack > 1 ? html`<label class="field">Quantity<input type="number" value=${f.qty} onInput=${set('qty')} /></label>` : null}
    ${d.armor?.dpMax ? html`<label class="field">Durability (DP / ${d.armor.dpMax})<input type="number" value=${f.dp} onInput=${set('dp')} /></label>` : null}
    <label class="field full">Notes<textarea rows="3" value=${f.notes} onInput=${set('notes')} /></label></div><//>`;
}

export function inspect(v, it) {
  const d = M.def(v, it);
  openModal(close => html`<${Modal} title=${M.itemName(v, it)} footer=${html`<button onClick=${() => close()}>Close</button>`}>
    <div class="row nowrap" style=${{ alignItems: 'flex-start' }}>
      <div style=${{ width: '260px', height: '140px', position: 'relative', background: '#0b141b', border: '1px solid var(--line2)', borderRadius: '4px' }}><${ItemArt} v=${v} item=${it} w=${260} h=${140} /></div>
      <pre class="small" style=${{ whiteSpace: 'pre-wrap', margin: 0, flex: 1 }}>${tileTip(v, it)}</pre></div>
    ${d?.magazine || d?.weapon?.integral ? html`<h3 style=${{ marginTop: '10px' }}>Contents (top = next round fired)</h3>${[...(it.rounds || [])].reverse().map(([a, n]) => html`<div>${n} × ${v.defs[a]?.name || a}</div>`)}${!M.roundCount(it.rounds) ? html`<div class="dim">Empty</div>` : null}` : null}
    ${it.notes ? html`<p class="muted">${it.notes}</p>` : null}
  <//>`);
}

/* ================================================================ composite inventory view */
/**
 * Character inventory: equipment slots + pockets, equipped container grids, and on the right a
 * selectable storage source (ground, stashes, released loot, open containers).
 */
export function CharacterInventory({ v, charId, extraRight, customize, traderId }) {
  const c = v.characters[charId];
  const [open, setOpen] = useState([]);
  const [source, setSource] = useState('ground');
  const [q, setQ] = useState('');
  if (!c) return html`<div class="empty">Choose a character.</div>`;
  const ref = 'char:' + charId;
  const ctx = { charId, customize, traderId, openContainer: id => setOpen(o => (o.includes(id) ? o : [...o, id])), filter: q ? it => !M.itemName(v, it).toLowerCase().includes(q.toLowerCase()) : null };
  const equippedContainers = M.children(v, ref).filter(i => i.loc.slot !== undefined && M.def(v, i)?.container);
  const stashes = Object.values(v.stashes || {}).filter(s => v.role === 'gm' ? s.ownerCharId === charId || !s.ownerCharId : true);
  const loot = Object.values(v.characters).filter(x => x.kind === 'npc' && (v.role === 'gm' ? false : x.lootable));
  const sources = [['ground', 'Ground'], ...stashes.map(s => ['stash:' + s.id, s.name]), ...loot.map(n => ['loot:' + n.id, `Loot: ${n.name}`])];
  const enc = c.derived;
  return html`<div class="inv-layout">
    <section class="panel"><header><h2 class="grow">Equipment</h2><span class="muted small">${c.name}</span></header><div class="body col">
      <div class="slots">
        <${Slot} v=${v} charId=${charId} slot="helmet" label="Helmet" ctx=${ctx} /><${Slot} v=${v} charId=${charId} slot="face" label="Face" ctx=${ctx} /><${Slot} v=${v} charId=${charId} slot="armor" label="Body armor" ctx=${ctx} />
        <${Slot} v=${v} charId=${charId} slot="rig" label="Rig" ctx=${ctx} /><${Slot} v=${v} charId=${charId} slot="backpack" label="Backpack" ctx=${ctx} /><${Slot} v=${v} charId=${charId} slot="melee" label="Melee" ctx=${ctx} />
        <${Slot} v=${v} charId=${charId} slot="primary" label="Primary weapon" ctx=${ctx} cls="wide" /><${Slot} v=${v} charId=${charId} slot="secondary" label="Secondary weapon" ctx=${ctx} cls="wide" />
        <${Slot} v=${v} charId=${charId} slot="holster" label="Holster" ctx=${ctx} cls="w2" /><${Slot} v=${v} charId=${charId} slot="artifact1" label="Artifact" ctx=${ctx} />
      </div>
      <${Grid} v=${v} parentRef=${ref} grid=${M.gridsOf(v, ref)[0]} ctx=${ctx} />
      <div class="weight-bar"><span ...${tipProps(`Basic Lift ${enc?.basicLiftKg} kg (ST²/5 lb, B15)\nEncumbrance levels at 1×, 2×, 3×, 6×, 10× BL (B17)\nDodge ${enc?.dodge}, Move ${enc?.move}`)}>⚖ ${enc?.carriedKg} kg · <b>${enc?.encumbrance}</b> encumbrance · BL ${enc?.basicLiftKg} kg</span><span class="right">${money(c.session.money)}</span></div>
    </div></section>
    <section class="panel"><header><h2 class="grow">Carried storage</h2></header><div class="body col">
      ${equippedContainers.length ? equippedContainers.map(ct => html`<div><b class="small">${M.itemName(v, ct)}</b>${M.def(v, ct).container.grids.map(g => html`<${Grid} v=${v} parentRef=${'item:' + ct.id} grid=${g} ctx=${ctx} />`)}</div>`) : html`<div class="empty">Equip a rig or backpack for more storage.</div>`}
    </div></section>
    <section class="panel"><header><h2 class="grow">Storage</h2><input class="search" placeholder="Search items… (Ctrl+F)" value=${q} onInput=${e => setQ(e.target.value)} /></header><div class="body col">
      <div class="tabs">${sources.map(([k, l]) => html`<button class=${source === k ? 'active' : ''} onClick=${() => setSource(k)}>${l}</button>`)}</div>
      <div class="scroll" style=${{ maxHeight: 'calc(100vh - 290px)' }}>
        ${source === 'ground' ? html`<${Grid} v=${v} parentRef=${ref} grid=${M.gridsOf(v, ref)[1]} ctx=${ctx} />` : null}
        ${source.startsWith('stash:') && v.stashes[source.slice(6)] ? html`<${Grid} v=${v} parentRef=${source} grid=${M.gridsOf(v, source)[0]} ctx=${ctx} />` : null}
        ${source.startsWith('loot:') ? html`<${LootView} v=${v} npcId=${source.slice(5)} ctx=${ctx} />` : null}
      </div>
      ${extraRight}
    </div></section>
    ${open.map((id, i) => v.items[id] ? html`<${FloatWin} key=${id} title=${M.itemName(v, v.items[id])} x=${200 + i * 30} y=${140 + i * 30} w=${Math.max(260, M.def(v, v.items[id]).container.grids.reduce((a, g) => Math.max(a, g.w), 1) * cellPx() + 40)} onClose=${() => setOpen(o => o.filter(x => x !== id))}>
      ${M.def(v, v.items[id]).container.grids.map(g => html`<${Grid} v=${v} parentRef=${'item:' + id} grid=${g} ctx=${ctx} />`)}<//>` : null)}
  </div>`;
}

/** Items of a dead/released NPC shown as a flat loot list (take individually). */
export function LootView({ v, npcId, ctx }) {
  const items = M.children(v, 'char:' + npcId);
  const all = M.descendants(v, 'char:' + npcId).filter(i => i.loc.mount === undefined);
  return html`<div class="col">
    <div class="row"><span class="muted">${all.length} item(s)</span><button class="small right" onClick=${async () => { for (const it of items) await run('item.transfer', { itemId: it.id, to: 'char:' + ctx.charId }); }}>Take all</button></div>
    ${items.map(it => html`<div class="list-item" onContextMenu=${e => itemMenu(e, v, it, ctx)}>
      <div style=${{ width: '80px', height: '36px', position: 'relative' }}><${ItemArt} v=${v} item=${it} w=${80} h=${36} /></div>
      <span class="grow">${M.itemName(v, it)}${it.qty > 1 ? ` ×${it.qty}` : ''}</span>
      <button class="small" onClick=${() => run('item.transfer', { itemId: it.id, to: 'char:' + ctx.charId }, { ok: true })}>Take</button></div>`)}
  </div>`;
}

/** Single storage view (stash / trader / NPC) for GM screens. */
export function StorageView({ v, parentRef, ctx = {}, prices }) {
  return html`<div class="col">${M.gridsOf(v, parentRef).map(g => html`<${Grid} v=${v} parentRef=${parentRef} grid=${g} ctx=${ctx} prices=${prices} />`)}</div>`;
}

// keyboard: R rotates the selected item, Q quick-loads it
window.addEventListener('keydown', e => {
  if (drag || e.target.matches('input,textarea,select')) return;
  const v = conn.view; const it = v?.items?.[selection.id]; if (!it) return;
  if ((e.key === 'r' || e.key === 'R') && it.loc?.g !== undefined) run('item.rotate', { itemId: it.id });
  if (e.key === 'q' || e.key === 'Q') { const d = M.def(v, it); if (d?.magazine || d?.weapon?.integral) run('item.quickLoad', { holderId: it.id }); }
  if (e.key === 'Delete' && v.role === 'gm') run('item.delete', { itemId: it.id });
});
