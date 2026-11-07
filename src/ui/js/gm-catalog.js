// Item Catalog / Editor (GM): definitions, artwork library, attachment anchor editor.
import { html, useState, useEffect, useRef, run, Panel, Tabs, toast, askNumber, confirmBox, tipProps, useLocal, openMenu } from './ui.js';
import { TargetSelect, spawnItem, spawnTargets, getSpawnTarget, setSpawnTarget, targetLabel } from './spawn.js';
import * as M from './model.js';
import { ItemArt, cellPx, useArtAspect } from './inventory.js';
import { TokenField, PickField, idOptions, withSub, SUB_SKILL } from './idfields.js';
import { parseTable, rowsToDefs } from './table-import.js';
import { openModal, Modal } from './ui.js';

const CATS = { weapon: 'Weapons', armor: 'Armor & Clothing', equipment: 'Equipment', medical: 'Medical', material: 'Crafting Materials', artifact: 'Artifacts', ammo: 'Ammunition', magazine: 'Magazines', container: 'Containers', attachment: 'Attachments', misc: 'Miscellaneous' };
const SUBS = { weapon: ['Pistols', 'Revolvers', 'Submachine Guns', 'Shotguns', 'Assault Rifles', 'Battle Rifles', 'Marksman Rifles', 'Sniper Rifles', 'Rifles', 'Machine Guns', 'Launchers', 'Melee Weapons', 'Thrown'], armor: ['Body Armor', 'Helmets', 'Masks', 'Suits', 'Clothing'], equipment: ['Tactical Rigs', 'Backpacks', 'Tools', 'Electronics', 'Detectors', 'Lights', 'Food & Drink'], medical: ['Bandages', 'Medkits', 'Drugs', 'Anti-radiation', 'Stimulants'], material: ['Parts', 'Chemicals', 'Mutant Parts', 'Electronics', 'Repair'], artifact: ['Gravitational', 'Chemical', 'Fire', 'Electrical', 'Miscellaneous'], ammo: ['Pistol', 'Rifle', 'Shotgun', 'Grenades'], magazine: ['Pistol', 'SMG', 'Rifle', 'Shotgun', 'Stripper Clips'], container: ['Pouches', 'Cases', 'Storage'], attachment: ['Optics', 'Muzzle Devices', 'Foregrips', 'Stocks', 'Tactical Devices', 'Underbarrel'], misc: ['Valuables', 'Documents', 'Keys', 'Junk'] };
const TRADERS = ['medic', 'technician', 'general', 'weapons', 'armor', 'equipment'];
const LOCS = ['skull', 'face', 'eye', 'neck', 'torso', 'vitals', 'groin', 'arm', 'leg', 'hand', 'foot'];
const MOUNT_SLOTS = ['magazine', 'optic', 'muzzle', 'underbarrel', 'foregrip', 'stock', 'side', 'other'];
const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

/* ---------------------------------------------------------- image helpers (never modify originals) */
async function uploadBlob(blob, name, derivedFrom) {
  const bmp = await createImageBitmap(blob);
  const r = await fetch('/api/assets', { method: 'POST', body: blob, headers: { 'x-name': name.slice(0, 120), 'x-width': bmp.width, 'x-height': bmp.height, ...(derivedFrom ? { 'x-derived-from': derivedFrom } : {}) } });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Upload failed');
  return j.id;
}
export function pickImage() {
  return new Promise(res => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/png,image/webp,image/jpeg,image/gif'; inp.onchange = async () => { const f = inp.files[0]; if (!f) return res(null); try { res(await uploadBlob(f, f.name)); } catch (e) { toast(e.message, 'error'); res(null); } }; inp.click(); });
}
async function loadCanvas(url) {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  return { c, g };
}
/** Bounding box of non-transparent pixels, as percentages (stored as crop metadata). */
async function autoTrim(v, assetId) {
  const { c, g } = await loadCanvas(M.imageUrl(v, assetId));
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  if (x1 < 0) return toast('Image is fully transparent.', 'error');
  const crop = { x: (x0 / c.width) * 100, y: (y0 / c.height) * 100, w: ((x1 - x0 + 1) / c.width) * 100, h: ((y1 - y0 + 1) / c.height) * 100 };
  run('asset.update', { id: assetId, crop }, { ok: 'Trim saved (original file unchanged)' });
}
/** Remove a flat background colour (sampled from the corners) into a NEW derived PNG. */
async function removeBackground(v, assetId, tolerance = 40) {
  const { c, g } = await loadCanvas(M.imageUrl(v, assetId));
  const img = g.getImageData(0, 0, c.width, c.height); const d = img.data;
  const corners = [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1]].map(([x, y]) => (y * c.width + x) * 4);
  const ref = [0, 1, 2].map(k => corners.reduce((a, i) => a + d[i + k], 0) / 4);
  // flood fill from the edges so interior colours matching the background are kept
  const seen = new Uint8Array(c.width * c.height); const stack = [];
  for (let x = 0; x < c.width; x++) stack.push(x, (c.height - 1) * c.width + x);
  for (let y = 0; y < c.height; y++) stack.push(y * c.width, y * c.width + c.width - 1);
  while (stack.length) {
    const p = stack.pop(); if (seen[p]) continue; seen[p] = 1;
    const i = p * 4; const dist = Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]);
    if (dist > tolerance || d[i + 3] === 0 && false) continue;
    d[i + 3] = 0;
    const x = p % c.width, y = (p / c.width) | 0;
    if (x > 0) stack.push(p - 1); if (x < c.width - 1) stack.push(p + 1); if (y > 0) stack.push(p - c.width); if (y < c.height - 1) stack.push(p + c.width);
  }
  g.putImageData(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return uploadBlob(blob, `${v.assets[assetId]?.name || 'image'} (background removed).png`, assetId);
}

function ImagePicker({ v, value, onChange, label = 'Image' }) {
  const url = M.imageUrl(v, value);
  const [busy, setBusy] = useState(false);
  return html`<div class="field"><span>${label}</span><div class="row">
    ${url ? html`<img src=${url} style=${{ maxWidth: '110px', maxHeight: '50px', background: '#0b141b', border: '1px solid var(--line2)' }} />` : html`<span class="dim">none (fallback art)</span>`}
    <button class="small" onClick=${async () => { const id = await pickImage(); if (id) onChange(id); }}>Import PNG…</button>
    <select class="small" value=${value || ''} onChange=${e => onChange(e.target.value)}><option value="">— none —</option>${Object.values(v.assets || {}).map(a => html`<option value=${a.id}>${a.name}</option>`)}${value?.startsWith('seed:') ? html`<option value=${value}>${value}</option>` : null}</select>
    ${value && !value.startsWith('seed:') ? html`<button class="small" onClick=${() => autoTrim(v, value)} ...${tipProps('Crop transparent borders (stored as metadata; the file is not changed).')}>Auto-fit</button>
      <button class="small" disabled=${busy} onClick=${async () => { setBusy(true); try { const id = await removeBackground(v, value); if (id) { onChange(id); toast('Created a new image without background; the original is kept.', 'ok'); } } catch (e) { toast(e.message, 'error'); } setBusy(false); }}>Remove background</button>` : null}
  </div></div>`;
}

/**
 * The item exactly as it will look in an inventory grid (same cell size), plus a size check:
 * a long, thin picture (a suppressor, a rifle) in a small or square footprint is drawn tiny,
 * so the GM can match the footprint to the picture with one click.
 */
function GridPreview({ v, d, setD }) {
  const aspect = useArtAspect(v, d.image);
  const cell = cellPx();
  const w = Math.max(1, Number(d.w) || 1), h = Math.max(1, Number(d.h) || 1);
  const key = d.id || '__preview';
  const pv = { ...v, defs: { ...v.defs, [key]: { ...d, w, h } } };
  const tileW = w * cell - 2, tileH = h * cell - 2;
  // footprint whose shape best matches the picture, keeping the short side
  const fit = (() => {
    if (!aspect) return null;
    if (aspect >= 1) { const hh = Math.min(w, h); return { w: Math.min(10, Math.max(1, Math.round(hh * aspect))), h: hh }; }
    const ww = Math.min(w, h); return { w: ww, h: Math.min(10, Math.max(1, Math.round(ww / aspect))) };
  })();
  const ratio = aspect ? aspect / (w / h) : 1;
  const mismatch = fit && (ratio > 1.6 || ratio < 1 / 1.6) && (fit.w !== w || fit.h !== h);
  return html`<div class="full grid-preview">
    <div class="row small"><span class="muted">In the inventory (${w}×${h} cells)</span>${aspect ? html`<span class="dim">· picture ${aspect >= 1 ? aspect.toFixed(1) + ':1' : '1:' + (1 / aspect).toFixed(1)}</span>` : null}</div>
    <div class="row" style=${{ alignItems: 'flex-start', gap: '14px' }}>
      <div class="tile cat-${d.category || 'misc'}" style=${{ position: 'relative', width: tileW + 'px', height: tileH + 'px', flex: 'none', cursor: 'default' }}>
        <div class="tile-art"><${ItemArt} v=${pv} item=${{ id: '__preview', defId: key }} w=${tileW} h=${tileH - 12} /></div>
        <span class="name">${d.name || 'New item'}</span>
      </div>
      ${mismatch ? html`<div class="col small" style=${{ maxWidth: '300px' }}>
        <span class="warn">The picture is much ${ratio > 1 ? 'longer' : 'taller'} than the item’s ${w}×${h} footprint, so it is drawn small in the grid.</span>
        <button class="small" onClick=${() => setD({ ...d, w: fit.w, h: fit.h })}>Fit size to picture → ${fit.w}×${fit.h}</button>
        <span class="dim">Or keep ${w}×${h} if that is the size you want in the game.</span></div>` : null}
    </div></div>`;
}

/* ---------------------------------------------------------- anchor editor */
function AnchorEditor({ v, d, setD }) {
  const url = M.imageUrl(v, d.image);
  const mounts = d.weapon?.mounts || [];
  const [sel, setSel] = useState(0);
  const [preview, setPreview] = useState({});
  const [nat, setNat] = useState(null);
  const box = useRef();
  const W = 520;
  useEffect(() => { if (!url) return; const i = new Image(); i.onload = () => setNat({ w: i.naturalWidth, h: i.naturalHeight }); i.src = url; }, [url]);
  if (!d.weapon) return null;
  const H = nat ? (W * nat.h) / nat.w : 200;
  const setMount = (i, patch) => { const m = mounts.slice(); m[i] = { ...m[i], ...patch }; setD({ ...d, weapon: { ...d.weapon, mounts: m } }); };
  const dragPin = (i, e) => {
    e.preventDefault(); setSel(i);
    const r = box.current.getBoundingClientRect();
    const move = ev => setMount(i, { x: Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * 1000) / 1000, y: Math.round(Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) * 1000) / 1000 });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const m = mounts[sel];
  const attachDefs = Object.values(v.defs).filter(x => x.attachment || x.magazine);
  return html`<${Panel} title="Attachment points (anchor editor)">
    <div class="small muted">Drag a pin to place the mount on the base image. Attachments installed on this weapon are drawn at these anchors (their own anchor/scale is set on the attachment). Preview below uses the real compatibility rules.</div>
    ${url ? html`<div class="anchor-editor" ref=${box} style=${{ width: W + 'px', height: H + 'px', marginTop: '8px' }}>
      <img src=${url} style=${{ width: '100%', height: '100%', display: 'block' }} draggable="false" />
      ${mounts.map((mt, i) => { const pid = preview[mt.id]; const pd = v.defs[pid]; const art = pd?.attachment?.art || { anchorX: 0.5, anchorY: 0.5, scale: 1 }; const purl = M.imageUrl(v, pd?.attachment?.art?.image || pd?.image);
        return html`${purl ? html`<img src=${purl} style=${{ position: 'absolute', width: W * (mt.scale || 0.2) * (art.scale || 1) * (mt.offsets?.[pid]?.scale || 1) + 'px', left: (mt.x + (mt.offsets?.[pid]?.x || 0)) * 100 + '%', top: (mt.y + (mt.offsets?.[pid]?.y || 0)) * 100 + '%', transform: `translate(-${(art.anchorX ?? 0.5) * 100}%, -${(art.anchorY ?? 0.5) * 100}%) rotate(${(mt.rot || 0) + (mt.offsets?.[pid]?.rot || 0)}deg)`, transformOrigin: `${(art.anchorX ?? 0.5) * 100}% ${(art.anchorY ?? 0.5) * 100}%`, zIndex: (mt.z || 1) + 1, pointerEvents: 'none' }} />` : null}
          <div class="pin ${i === sel ? 'sel' : ''}" style=${{ left: mt.x * 100 + '%', top: mt.y * 100 + '%' }} onPointerDown=${e => dragPin(i, e)}><span>${mt.label}</span></div>`; })}
    </div>` : html`<div class="empty">Import a base image first.</div>`}
    <div class="row" style=${{ marginTop: '8px' }}>${mounts.map((mt, i) => html`<button class="small ${i === sel ? 'primary' : ''}" onClick=${() => setSel(i)}>${mt.label}</button>`)}<button class="small" onClick=${() => { setD({ ...d, weapon: { ...d.weapon, mounts: [...mounts, { id: 'mount' + (mounts.length + 1), label: 'New mount', slot: 'side', interfaces: ['picatinny'], x: 0.5, y: 0.5, rot: 0, scale: 0.15, z: 2, offsets: {} }] } }); setSel(mounts.length); }}>+ Mount</button></div>
    ${m ? html`<div class="form" style=${{ marginTop: '8px' }}>
      <label class="field">Id<input value=${m.id} onInput=${e => setMount(sel, { id: e.target.value.replace(/[^\w-]/g, '') })} /></label>
      <label class="field">Label<input value=${m.label} onInput=${e => setMount(sel, { label: e.target.value })} /></label>
      <label class="field">Category<select value=${m.slot} onChange=${e => setMount(sel, { slot: e.target.value })}>${MOUNT_SLOTS.map(s => html`<option value=${s}>${s}</option>`)}</select></label>
      <${TokenField} label="Accepted interfaces" cls="wide" tip="Explicit compatibility keys, e.g. picatinny, ak-dovetail, thread-7.62x39. Attachments must list one of these. Interfaces of attachments for this mount category are listed first." value=${m.interfaces} options=${idOptions(v, 'mountInterface', { ...d, __mountSlot: m.slot })} onChange=${x => setMount(sel, { interfaces: x })} />
      <label class="field">X<input type="number" step="0.01" value=${m.x} onInput=${e => setMount(sel, { x: Number(e.target.value) })} /></label>
      <label class="field">Y<input type="number" step="0.01" value=${m.y} onInput=${e => setMount(sel, { y: Number(e.target.value) })} /></label>
      <label class="field">Rotation°<input type="number" value=${m.rot} onInput=${e => setMount(sel, { rot: Number(e.target.value) })} /></label>
      <label class="field" ...${tipProps('Width of the attachment art relative to the weapon image width.')}>Scale<input type="number" step="0.01" value=${m.scale} onInput=${e => setMount(sel, { scale: Number(e.target.value) })} /></label>
      <label class="field">Layer (z)<input type="number" value=${m.z} onInput=${e => setMount(sel, { z: Number(e.target.value) })} /></label>
      <label class="field wide">Preview attachment<select value=${preview[m.id] || ''} onChange=${e => setPreview({ ...preview, [m.id]: e.target.value })}><option value="">none</option>${attachDefs.filter(a => (m.slot === 'magazine' ? M.magFitsWeapon(a, d) : M.attachFits(a, m, d))).map(a => html`<option value=${a.id}>${a.name}</option>`)}</select></label>
      ${preview[m.id] ? html`<div class="field wide" ...${tipProps('Per-model offset for this specific attachment (fine positioning).')}>Offset for ${v.defs[preview[m.id]]?.name}<div class="row">${['x', 'y', 'rot', 'scale'].map(k => html`<input type="number" step=${k === 'rot' ? 1 : 0.01} placeholder=${k} value=${m.offsets?.[preview[m.id]]?.[k] ?? ''} onInput=${e => setMount(sel, { offsets: { ...m.offsets, [preview[m.id]]: { ...(m.offsets?.[preview[m.id]] || {}), [k]: e.target.value === '' ? undefined : Number(e.target.value) } } })} style=${{ width: '60px' }} />`)}</div></div>` : null}
      <div class="field"><span> </span><button class="small danger" onClick=${() => { setD({ ...d, weapon: { ...d.weapon, mounts: mounts.filter((_, j) => j !== sel) } }); setSel(0); }}>Remove mount</button></div>
    </div>` : null}
  <//>`;
}

/* ---------------------------------------------------------- definition editor */
function num(d, setD, path, label, step = 1, tip) {
  const [a, b] = path.split('.');
  const val = b ? d[a]?.[b] : d[a];
  return html`<label class="field" ...${tipProps(tip)}>${label}<input type="number" step=${step} value=${val ?? ''} onInput=${e => { const n = e.target.value === '' ? undefined : Number(e.target.value); setD(b ? { ...d, [a]: { ...d[a], [b]: n } } : { ...d, [a]: n }); }} /></label>`;
}
function txt(d, setD, path, label, tip, cls = '') {
  const [a, b] = path.split('.');
  const val = b ? d[a]?.[b] : d[a];
  return html`<label class="field ${cls}" ...${tipProps(tip)}>${label}<input value=${Array.isArray(val) ? val.join(', ') : val ?? ''} onInput=${e => setD(b ? { ...d, [a]: { ...d[a], [b]: e.target.value } } : { ...d, [a]: e.target.value })} /></label>`;
}

/** Starting values when a behaviour is switched on. */
function behaviourInit(key, d) {
  switch (key) {
    case 'weapon': return { kind: d.sub === 'Melee Weapons' ? 'melee' : 'ranged', skill: SUB_SKILL[d.sub] || 'Guns (Rifle)', damage: d.sub === 'Melee Weapons' ? 'sw-1 cut' : '5d pi', acc: 4, range: '500/3000', rof: '3', shots: '10+1(3)', bulk: -5, rcl: 2, minST: 10, calibers: [], magFamilies: [], mounts: [] };
    case 'magazine': return { family: '', capacity: d.sub === 'Stripper Clips' ? 5 : 30, calibers: [], clip: d.sub === 'Stripper Clips' };
    case 'ammo': return { caliber: '' };
    case 'attachment': return { slot: 'optic', interfaces: ['picatinny'], mods: {}, extend: { w: 0, h: 0 } };
    case 'armor': return { dr: 2, locations: ['torso', 'vitals'] };
    case 'container': return { grids: [{ id: 'main', label: 'Main', w: 4, h: 4 }] };
    case 'consumable': return { heal: 1 };
    case 'artifact': return { effects: [] };
    default: return {};
  }
}
/** The behaviour that goes with a category, switched on when the category is chosen. */
const CATEGORY_BEHAVIOUR = { weapon: 'weapon', magazine: 'magazine', ammo: 'ammo', attachment: 'attachment', armor: 'armor', container: 'container', medical: 'consumable', artifact: 'artifact' };
function withCategory(d, category) {
  const out = { ...d, category, sub: '' };
  const key = CATEGORY_BEHAVIOUR[category];
  if (key && !out[key]) out[key] = behaviourInit(key, out);
  return out;
}

/** Id fields bound to a definition path: several ids (chips) or one id, with catalog drop-downs. */
function tok(v, d, setD, path, label, kind, tip, cls = '') {
  const [a, b] = path.split('.');
  return html`<${TokenField} label=${label} tip=${tip} cls=${cls} value=${b ? d[a]?.[b] : d[a]} options=${idOptions(v, kind, d)} onChange=${x => setD(b ? { ...d, [a]: { ...d[a], [b]: x } } : { ...d, [a]: x })} />`;
}
function pick(v, d, setD, path, label, kind, tip, cls = '') {
  const [a, b] = path.split('.');
  return html`<${PickField} label=${label} tip=${tip} cls=${cls} value=${b ? d[a]?.[b] : d[a]} options=${idOptions(v, kind, d)} onChange=${x => setD(b ? { ...d, [a]: { ...d[a], [b]: x } } : { ...d, [a]: x })} />`;
}

function DefEditor({ v, def, onSaved }) {
  const [d, setD] = useState(() => structuredClone(def));
  useEffect(() => setD(structuredClone(def)), [def.id]);
  const save = async () => {
    const out = structuredClone(d);
    for (const [sec, keys] of Object.entries({ weapon: ['calibers', 'magFamilies'], magazine: ['calibers'], attachment: ['interfaces', 'weapons'], ammo: ['onlyWeapons'], consumable: ['cures'] })) if (out[sec]) for (const k of keys) if (typeof out[sec][k] === 'string') out[sec][k] = list(out[sec][k]);
    if (typeof out.tags === 'string') out.tags = list(out.tags);
    if (out.weapon && out.weapon.integralCap !== undefined) { out.weapon.integral = out.weapon.integralCap ? { capacity: Number(out.weapon.integralCap) } : null; delete out.weapon.integralCap; }
    if (out.artifact && typeof out.artifact.effects === 'string') out.artifact.effects = out.artifact.effects.split('\n').filter(Boolean);
    const r = await run('def.save', { def: out }, { ok: 'Saved' });
    if (r) onSaved?.(r.result.id);
  };
  const section = (key, label) => html`<label class="row small"><input type="checkbox" data-behaviour=${key} checked=${!!d[key]} onChange=${e => setD({ ...d, [key]: e.target.checked ? behaviourInit(key, d) : undefined })} /> ${label}</label>`;
  return html`<div class="col">
    <div class="row"><h2 class="grow">${d.name || 'New item'}</h2><button class="primary" onClick=${save}>Save definition</button><button onClick=${() => run('def.duplicate', { id: def.id }, { ok: 'Duplicated' })}>Duplicate</button>
      <button class="danger" onClick=${async () => { if (await confirmBox('Delete definition', `Delete ${def.name}? Only possible when no instances exist.`)) run('def.delete', { id: def.id }); }}>Delete</button></div>
    <div class="cols c2">
      <${Panel} title="General"><div class="form">
        ${txt(d, setD, 'name', 'Name', '', 'wide')}
        <label class="field">Category<select value=${d.category} onChange=${e => setD(withCategory(d, e.target.value))}>${Object.entries(CATS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <${PickField} label="Subcategory" tip="Weapons: picking the subcategory fills in the weapon skill (e.g. Shotguns → Guns (Shotgun))." value=${d.sub} options=${(SUBS[d.category] || []).map(x => ({ value: x, group: CATS[d.category] }))} onChange=${x => setD(withSub(d, x))} />
        ${num(d, setD, 'value', 'Value (₽)')}${num(d, setD, 'weight', 'Weight (kg)', 0.01)}${num(d, setD, 'w', 'Width (cells)')}${num(d, setD, 'h', 'Height (cells)')}${num(d, setD, 'stack', 'Stack size')}${num(d, setD, 'tier', 'Tier')}
        <label class="field">Rarity<select value=${d.rarity} onChange=${e => setD({ ...d, rarity: e.target.value })}>${['common', 'uncommon', 'rare', 'very rare', 'unique'].map(r => html`<option value=${r}>${r}</option>`)}</select></label>
        ${tok(v, d, setD, 'tags', 'Tags', 'tag', '"gm-only" hides the definition from players; "no-trade" keeps it out of generated shops.')}
        <label class="field full">Description<textarea rows="3" value=${d.description} onInput=${e => setD({ ...d, description: e.target.value })} /></label>
        <div class="full"><${ImagePicker} v=${v} value=${d.image} onChange=${id => setD({ ...d, image: id })} label="Base image (PNG)" /></div>
        <${GridPreview} v=${v} d=${d} setD=${setD} />
        <div class="field full"><span>Trader availability (empty = by category)</span><div class="row">${TRADERS.map(t => html`<label class="row small"><input type="checkbox" checked=${(d.traders || []).includes(t)} onChange=${e => setD({ ...d, traders: e.target.checked ? [...(d.traders || []), t] : d.traders.filter(x => x !== t) })} /> ${t}</label>`)}</div></div>
      </div><//>
      <${Panel} title="Behaviour"><div class="col">
        <div class="row">${section('weapon', 'Weapon')}${section('magazine', 'Magazine')}${section('ammo', 'Ammunition')}${section('attachment', 'Attachment')}
          ${section('armor', 'Armor')}${section('container', 'Container')}${section('consumable', 'Consumable')}${section('artifact', 'Artifact')}</div>
        ${d.weapon ? html`<h3>Weapon</h3><div class="form">
          <label class="field">Kind<select value=${d.weapon.kind} onChange=${e => setD({ ...d, weapon: { ...d.weapon, kind: e.target.value } })}><option value="ranged">Ranged</option><option value="melee">Melee</option></select></label>
          ${pick(v, d, setD, 'weapon.skill', 'Skill', 'weaponSkill', 'GURPS skill used to attack. Set automatically from the subcategory; pick another or type any GCS skill name.')}${txt(d, setD, 'weapon.damage', 'Damage', 'GURPS damage, e.g. 5d+1 pi, 2d(2) pi, sw+2 cut')}
          ${d.weapon.kind === 'ranged' ? html`${num(d, setD, 'weapon.acc', 'Acc')}${txt(d, setD, 'weapon.range', 'Range (½D/Max)')}${txt(d, setD, 'weapon.rof', 'RoF')}${txt(d, setD, 'weapon.shots', 'Shots')}${num(d, setD, 'weapon.bulk', 'Bulk')}${num(d, setD, 'weapon.rcl', 'Rcl')}${num(d, setD, 'weapon.minST', 'Min ST')}
            ${tok(v, d, setD, 'weapon.calibers', 'Calibers', 'caliber', 'Caliber ids this weapon can fire, e.g. 7.62x39')}${tok(v, d, setD, 'weapon.magFamilies', d.weapon.integralCap || d.weapon.integral ? 'Stripper-clip families' : 'Magazine families', 'magFamily', d.weapon.integralCap || d.weapon.integral ? 'Clip families that load the internal magazine (e.g. sks, mosin)' : 'Magazine family ids that fit. Families of magazines that take this weapon’s calibers are listed first.')}
            <label class="field" ...${tipProps('Set for tube/cylinder/internal magazines; leave empty for detachable magazines.')}>Internal capacity<input type="number" value=${d.weapon.integralCap ?? d.weapon.integral?.capacity ?? ''} onInput=${e => setD({ ...d, weapon: { ...d.weapon, integralCap: e.target.value } })} /></label>` : html`${txt(d, setD, 'weapon.reach', 'Reach')}${txt(d, setD, 'weapon.parry', 'Parry')}`}
          ${txt(d, setD, 'weapon.notes', 'Notes', '', 'full')}</div>` : null}
        ${d.magazine ? html`<h3>Magazine</h3><div class="form">${tok(v, d, setD, 'magazine.calibers', 'Calibers', 'caliber')}${pick(v, d, setD, 'magazine.family', 'Family id', 'family', 'Weapons list the families they accept. Families of weapons that fire these calibers are listed first.')}${num(d, setD, 'magazine.capacity', 'Capacity')}
          <label class="field" ...${tipProps('A stripper clip loads an internal magazine (SKS, Mosin) and is then put away.')}><span>Stripper clip</span><select value=${d.magazine.clip || d.sub === 'Stripper Clips' ? 'y' : 'n'} onChange=${e => setD({ ...d, magazine: { ...d.magazine, clip: e.target.value === 'y' } })}><option value="n">No — detachable magazine</option><option value="y">Yes — stripper clip</option></select></label></div>` : null}
        ${d.ammo ? html`<h3>Ammunition</h3><div class="form">${pick(v, d, setD, 'ammo.caliber', 'Caliber id', 'caliber')}${txt(d, setD, 'ammo.label', 'Load (FMJ/HP/AP…)')}${num(d, setD, 'ammo.divisor', 'Armor divisor', 0.5, 'HP = 0.5, AP = 2')}${num(d, setD, 'ammo.woundShift', 'Wounding size shift', 1, '+1 makes pi into pi+, etc.')}${num(d, setD, 'ammo.projectiles', 'Projectiles')}${txt(d, setD, 'ammo.damage', 'Damage override', 'e.g. 1d+1 pi for buckshot')}${tok(v, d, setD, 'ammo.onlyWeapons', 'Only fits weapons', 'ammoWeapon', 'Optional restriction, e.g. PMM only in the Klin. Weapons that fire this caliber are listed first.', 'wide')}</div>` : null}
        ${d.attachment ? html`<h3>Attachment</h3><div class="form">
          <label class="field">Mount category<select value=${d.attachment.slot} onChange=${e => setD({ ...d, attachment: { ...d.attachment, slot: e.target.value } })}>${MOUNT_SLOTS.filter(s => s !== 'magazine').map(s => html`<option value=${s}>${s}</option>`)}</select></label>
          ${tok(v, d, setD, 'attachment.interfaces', 'Interfaces', 'interface', 'The attachment fits mounts that accept one of these. Interfaces used by mounts of this category are listed first.')}${tok(v, d, setD, 'attachment.weapons', 'Only weapons', 'attachWeapon', 'Optional proprietary whitelist. Weapons with a matching mount are listed first.', 'wide')}
          ${['acc', 'scope', 'rcl', 'bulk'].map(k => html`<label class="field">${k} modifier<input type="number" value=${d.attachment.mods?.[k] ?? ''} onInput=${e => setD({ ...d, attachment: { ...d.attachment, mods: { ...d.attachment.mods, [k]: e.target.value === '' ? undefined : Number(e.target.value) } } })} /></label>`)}
          <label class="field wide">Effect note<input value=${d.attachment.mods?.note || ''} onInput=${e => setD({ ...d, attachment: { ...d.attachment, mods: { ...d.attachment.mods, note: e.target.value } } })} /></label>
          <label class="field" ...${tipProps('Extra inventory cells added to the weapon (e.g. a suppressor adds 1 width).')}>Extends width<input type="number" value=${d.attachment.extend?.w || 0} onInput=${e => setD({ ...d, attachment: { ...d.attachment, extend: { ...d.attachment.extend, w: Number(e.target.value) } } })} /></label>
          <div class="full"><${ImagePicker} v=${v} value=${d.attachment.art?.image} onChange=${id => setD({ ...d, attachment: { ...d.attachment, art: { anchorX: 0.5, anchorY: 0.5, scale: 1, ...(d.attachment.art || {}), image: id } } })} label="Overlay image (transparent PNG)" /></div>
          ${['anchorX', 'anchorY', 'scale'].map(k => html`<label class="field" ...${tipProps(k === 'scale' ? 'Multiplier on the mount scale' : 'Point of the overlay (0–1) pinned to the mount anchor')}>${k}<input type="number" step="0.01" value=${d.attachment.art?.[k] ?? ''} onInput=${e => setD({ ...d, attachment: { ...d.attachment, art: { ...(d.attachment.art || {}), [k]: Number(e.target.value) } } })} /></label>`)}</div>` : null}
        ${d.armor ? html`<h3>Armor</h3><div class="form">${num(d, setD, 'armor.dr', 'DR')}
          <label class="field">Flexible<select value=${d.armor.flexible ? 'y' : 'n'} onChange=${e => setD({ ...d, armor: { ...d.armor, flexible: e.target.value === 'y' } })}><option value="n">No</option><option value="y">Yes</option></select></label>
          ${num(d, setD, 'armor.dt', 'DT (campaign)')}${num(d, setD, 'armor.dpMax', 'Max DP (campaign)')}${txt(d, setD, 'armor.material', 'Material')}
          <div class="field full"><span>Coverage</span><div class="row">${LOCS.map(l => html`<label class="row small"><input type="checkbox" checked=${d.armor.locations.includes(l)} onChange=${e => setD({ ...d, armor: { ...d.armor, locations: e.target.checked ? [...d.armor.locations, l] : d.armor.locations.filter(x => x !== l) } })} /> ${l}</label>`)}</div></div></div>` : null}
        ${d.container ? html`<h3>Storage grids</h3>${d.container.grids.map((g, i) => html`<div class="row">${['label', 'w', 'h'].map(k => html`<input placeholder=${k} value=${g[k]} type=${k === 'label' ? 'text' : 'number'} onInput=${e => { const gs = d.container.grids.slice(); gs[i] = { ...g, [k]: k === 'label' ? e.target.value : Number(e.target.value) }; setD({ ...d, container: { grids: gs } }); }} style=${{ width: k === 'label' ? '120px' : '60px' }} />`)}
          <${TokenField} label="" placeholder="accepts any category" value=${g.accepts || []} options=${idOptions(v, 'category', d)} onChange=${x => { const gs = d.container.grids.slice(); gs[i] = { ...g, accepts: x }; setD({ ...d, container: { grids: gs } }); }} /><button class="small ghost" onClick=${() => setD({ ...d, container: { grids: d.container.grids.filter((_, j) => j !== i) } })}>✕</button></div>`)}
          <button class="small" onClick=${() => setD({ ...d, container: { grids: [...d.container.grids, { id: 'g' + Date.now().toString(36), label: 'Pocket', w: 2, h: 2 }] } })}>+ Grid</button>` : null}
        ${d.consumable ? html`<h3>Consumable</h3><div class="form">${txt(d, setD, 'consumable.heal', 'HP restored', 'Number or dice, e.g. 1d')}${pick(v, d, setD, 'consumable.skill', 'Skill roll', 'medicalSkill', 'e.g. First Aid')}${num(d, setD, 'consumable.skillMod', 'Skill modifier')}${num(d, setD, 'consumable.uses', 'Uses per item')}${num(d, setD, 'consumable.fp', 'FP restored')}${tok(v, d, setD, 'consumable.cures', 'Removes conditions', 'condition', '', 'wide')}${num(d, setD, 'consumable.seconds', 'Seconds to use', 1, 'Combat time (1 s if empty)')}</div>` : null}
        ${d.artifact ? html`<h3>Artifact</h3><label class="field">Effects (one per line)<textarea rows="3" value=${Array.isArray(d.artifact.effects) ? d.artifact.effects.join('\n') : d.artifact.effects} onInput=${e => setD({ ...d, artifact: { ...d.artifact, effects: e.target.value } })} /></label>${num(d, setD, 'artifact.radiation', 'Radiation')}` : null}
      </div><//>
    </div>
    ${d.weapon ? html`<${AnchorEditor} v=${v} d=${d} setD=${setD} />` : null}
    ${d.weapon ? html`<${Panel} title="Preconfigured variant images (fallback when overlays lack art)">
      ${(d.variants || []).map((x, i) => html`<div class="row"><input placeholder="mount=defId, …" value=${Object.entries(x.requires || {}).map(([k, val]) => `${k}=${val}`).join(', ')} onInput=${e => { const vs = d.variants.slice(); vs[i] = { ...x, requires: Object.fromEntries(list(e.target.value).map(p => p.split('=').map(s => s.trim()))) }; setD({ ...d, variants: vs }); }} style=${{ width: '320px' }} /><${ImagePicker} v=${v} value=${x.image} onChange=${id => { const vs = d.variants.slice(); vs[i] = { ...x, image: id }; setD({ ...d, variants: vs }); }} label="" /><button class="small ghost" onClick=${() => setD({ ...d, variants: d.variants.filter((_, j) => j !== i) })}>✕</button></div>`)}
      <button class="small" onClick=${() => setD({ ...d, variants: [...(d.variants || []), { requires: {}, image: '' }] })}>+ Variant</button><//>` : null}
  </div>`;
}

const SHEET_EXAMPLE = 'Name\tCategory\tSubcategory\tDamage\tAcc\tRange\tRoF\tShots\tBulk\tRcl\tST\tCaliber\tMagazines\tWeight\tPrice\tSize\nAKM\tWeapon\tAssault Rifles\t5d pi\t5\t400/3000\t10\t30+1(3)\t-4\t2\t9\t7.62x39\tak762\t3.1\t28000\t5x2';

/** Paste rows from a spreadsheet; preview what will be created, then import in one go. */
async function pasteSheet(v) {
  const existing = Object.fromEntries(Object.values(v.defs).map(d => [d.name.toLowerCase(), d.id]));
  const defs = await openModal(close => {
    const Body = () => {
      const [text, setText] = useState('');
      const parsed = text.trim() ? rowsToDefs(parseTable(text), existing) : null;
      const counts = {};
      for (const d of parsed?.defs || []) counts[d.category] = (counts[d.category] || 0) + 1;
      const updates = (parsed?.defs || []).filter(d => v.defs[d.id]).length;
      return html`<${Modal} wide=${true} title="Paste items from a spreadsheet" footer=${html`<button onClick=${() => close(null)}>Cancel</button><button class="primary" disabled=${!parsed?.defs.length} onClick=${() => close(parsed.defs)}>Import ${parsed?.defs.length || ''} item${parsed?.defs.length === 1 ? '' : 's'}</button>`}>
        <div class="col small">
          <div>Select the rows in Excel or Google Sheets <b>including the header row</b>, copy, and paste below. Columns are matched by name — e.g. <span class="mono">Name, Category, Subcategory, Damage, Acc, Range, RoF, Shots, Bulk, Rcl, ST, Skill, Caliber, Magazines, Capacity, Internal, DR, Covers, Heal, Weight, Price, Size (5x2)</span>. Missing columns get sensible defaults; the weapon skill comes from the subcategory. Items with a name already in the catalog are updated.</div>
          <textarea rows="10" class="mono" placeholder=${SHEET_EXAMPLE} value=${text} onInput=${e => setText(e.target.value)} style=${{ width: '100%' }} />
          ${parsed ? html`<div class="row">${Object.entries(counts).map(([k, n]) => html`<span class="chip info">${n} ${k}</span>`)}${updates ? html`<span class="chip warn">${updates} update existing</span>` : null}
            ${parsed.columns.ignored.length ? html`<span class="chip" title=${'Not recognised: ' + parsed.columns.ignored.join(', ')}>${parsed.columns.ignored.length} column${parsed.columns.ignored.length === 1 ? '' : 's'} ignored</span>` : null}</div>
            ${parsed.problems.length ? html`<div class="notice-bar small" style=${{ maxHeight: '120px', overflow: 'auto' }}>${parsed.problems.map(p => html`<div>⚠ ${p}</div>`)}</div>` : null}
            <div class="scroll" style=${{ maxHeight: '200px' }}><table class="mini"><tr><th>Name</th><th>Category</th><th>Sub</th><th>Size</th><th>Details</th></tr>
              ${parsed.defs.slice(0, 200).map(d => html`<tr><td>${d.name}</td><td>${d.category}</td><td>${d.sub}</td><td>${d.w}×${d.h}</td><td class="dim">${d.weapon ? `${d.weapon.skill} · ${d.weapon.damage}${d.weapon.calibers?.length ? ' · ' + d.weapon.calibers.join(', ') : ''}` : d.magazine ? `${d.magazine.capacity} rds · ${d.magazine.family}` : d.ammo ? d.ammo.caliber : d.armor ? `DR ${d.armor.dr} · ${d.armor.locations.join(', ')}` : ''}</td></tr>`)}</table></div>` : null}
        </div><//>`;
    };
    return html`<${Body} />`;
  });
  if (!defs) return;
  const r = await run('def.import', { defs }, { ok: true });
  for (const e of r?.result?.errors || []) toast(e, 'error');
}

export function Catalog({ v }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useLocal('cat-filter', '');
  const [sel, setSel] = useLocal('cat-sel', null);
  const [spawnTo, setSpawnToState] = useLocal('cat-spawn-to', getSpawnTarget() || '');
  const setSpawnTo = r => { setSpawnToState(r); setSpawnTarget(r); };
  const to = spawnTo && targetLabel(v, spawnTo) !== '—' ? spawnTo : '';
  const spawnMenu = (e, x) => openMenu(e, [
    { header: x.name },
    { label: `Spawn 1 → ${to ? targetLabel(v, to) : '(choose a receiver)'}`, disabled: !to, onClick: () => spawnItem(v, x.id, to, { loaded: true }) },
    ...(x.stack > 1 ? [{ label: `Spawn a full stack (${x.stack})`, disabled: !to, onClick: () => spawnItem(v, x.id, to, { qty: x.stack }) }] : []),
    { label: 'Spawn amount…', disabled: !to, onClick: async () => { const n = await askNumber(`Spawn ${x.name}`, { value: 1, max: 10000 }); if (n) spawnItem(v, x.id, to, { qty: n, loaded: true }); } },
    { label: 'Spawn to…', sub: spawnTargets(v).slice(0, 40).map(t => ({ label: `${t.label} · ${t.group}`, onClick: () => { setSpawnTo(t.ref); spawnItem(v, x.id, t.ref, { loaded: true }); } })) },
    '-',
    { label: 'Edit', onClick: () => setSel(x.id) },
    { label: 'Duplicate', onClick: () => run('def.duplicate', { id: x.id }, { ok: true }) },
    { label: 'Delete', onClick: async () => { if (await confirmBox('Delete item', `Delete ${x.name} from the catalog?`)) run('def.delete', { id: x.id }); } },
  ]);
  const defs = Object.values(v.defs).filter(d => (!cat || d.category === cat) && `${d.name} ${d.sub} ${d.id}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.category.localeCompare(b.category) || (a.sub || '').localeCompare(b.sub || '') || a.name.localeCompare(b.name));
  const d = v.defs[sel] || defs[0];
  const groups = {};
  for (const x of defs) (groups[`${CATS[x.category]} › ${x.sub || 'Other'}`] ||= []).push(x);
  const exportCatalog = () => { const blob = new Blob([JSON.stringify(Object.values(v.defs), null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'catalog.json'; a.click(); };
  const importCatalog = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.onchange = async () => { try { const data = JSON.parse(await inp.files[0].text()); const r = await run('def.import', { defs: Array.isArray(data) ? data : data.defs || Object.values(data) }, { ok: true }); for (const e of r?.result?.errors || []) toast(e, 'error'); } catch (e) { toast(e.message, 'error'); } }; inp.click(); };
  return html`<div class="cols" style=${{ gridTemplateColumns: '330px 1fr' }}>
    <div class="col"><${Panel} title=${`Catalog (${Object.keys(v.defs).length})`} flat=${true} actions=${html`<button class="small primary" onClick=${async () => { const r = await run('def.save', { def: { name: 'New item', category: cat || 'misc', w: 1, h: 1 } }); if (r) setSel(r.result.id); }}>+ New</button>`}>
      <div class="col" style=${{ padding: '6px' }}>
        <div class="spawn-to"><span class="small">Spawn into</span><${TargetSelect} v=${v} value=${to} onChange=${setSpawnTo} cls="grow" /></div>
        <div class="tiny dim">Click <b>+</b> or double-click an item to spawn it there · right-click for amounts or another receiver.</div>
        <input class="search" placeholder="Search…" value=${q} onInput=${e => setQ(e.target.value)} />
        <select value=${cat} onChange=${e => setCat(e.target.value)}><option value="">All categories</option>${Object.entries(CATS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
        <div class="row"><button class="small good" onClick=${() => pasteSheet(v)} title="Copy rows from Excel / Google Sheets / a CSV (with a header row) and paste them here">📋 Paste from spreadsheet…</button><button class="small" onClick=${importCatalog}>Import JSON…</button><button class="small" onClick=${exportCatalog}>Export JSON</button></div>
        <div class="row"><button class="small" onClick=${async () => { if (await confirmBox('Load starter catalog', 'Add the built-in items (Tier 1 weapons, magazines, ammo, armor, medical, artifacts, attachments, containers), crafting recipes and NPC template gear? Items you already have are kept.', 'Load')) run('def.loadStarter', {}, { ok: true }); }}>Load starter catalog</button>
          <button class="small danger" disabled=${!Object.keys(v.defs).length} onClick=${async () => { if (await confirmBox('Remove unused items', 'Delete every catalog item that no character, NPC, stash or trader currently owns? Items in use are kept. Recipes and NPC gear that refer to removed items are cleaned up.', 'Remove')) run('def.deleteUnused', {}, { ok: true }); }}>Remove unused items</button></div></div>
      <div class="scroll h-lg">${Object.entries(groups).map(([g, items]) => html`<div class="grid-label" style=${{ padding: '0 8px' }}>${g}</div>${items.map(x => html`<div class="list-item cat-row ${d?.id === x.id ? 'sel' : ''}" onClick=${() => setSel(x.id)} onDblClick=${() => spawnItem(v, x.id, to, { loaded: true })} onContextMenu=${e => spawnMenu(e, x)} title="Double-click: spawn into the receiver · Right-click: more">
        ${M.imageUrl(v, x.image) ? html`<img src=${M.imageUrl(v, x.image)} style=${{ width: '46px', height: '24px', objectFit: 'contain' }} />` : html`<span style=${{ width: '46px' }} class="dim tiny">${x.w}×${x.h}</span>`}<span class="grow small">${x.name}</span><span class="tiny dim">${x.value}₽</span><button class="small spawn-btn" disabled=${!to} title=${to ? `Spawn 1 into ${targetLabel(v, to)}` : 'Choose a receiver above'} onClick=${e => { e.stopPropagation(); spawnItem(v, x.id, to, { loaded: true }); }}>+</button></div>`)}`)}</div><//>

    </div>
    ${d ? html`<${DefEditor} key=${d.id} v=${v} def=${d} onSaved=${setSel} />` : html`<div class="panel"><div class="body empty"><h2>The catalog is empty</h2><p>Create items with <b>+ New</b>, import a catalog JSON, or load the built-in starter catalog.</p>
      <div class="row" style=${{ justifyContent: 'center' }}><button class="primary" onClick=${async () => { const r = await run('def.save', { def: { name: 'New item', category: cat || 'misc', w: 1, h: 1 } }); if (r) setSel(r.result.id); }}>+ New item</button><button onClick=${importCatalog}>Import JSON…</button><button onClick=${() => run('def.loadStarter', {}, { ok: true })}>Load starter catalog</button></div></div></div>`}
  </div>`;
}
