// Item Catalog / Editor (GM): definitions, artwork library, attachment anchor editor.
import { html, useState, useEffect, useRef, run, Panel, Tabs, toast, askNumber, confirmBox, tipProps, useLocal } from './ui.js';
import * as M from './model.js';

const CATS = { weapon: 'Weapons', armor: 'Armor & Clothing', equipment: 'Equipment', medical: 'Medical', material: 'Crafting Materials', artifact: 'Artifacts', ammo: 'Ammunition', magazine: 'Magazines', container: 'Containers', attachment: 'Attachments', misc: 'Miscellaneous' };
const SUBS = { weapon: ['Pistols', 'Revolvers', 'Submachine Guns', 'Shotguns', 'Assault Rifles', 'Battle Rifles', 'Marksman Rifles', 'Sniper Rifles', 'Rifles', 'Machine Guns', 'Launchers', 'Melee Weapons', 'Thrown'], armor: ['Body Armor', 'Helmets', 'Masks', 'Suits', 'Clothing'], equipment: ['Tactical Rigs', 'Backpacks', 'Tools', 'Electronics', 'Detectors', 'Lights', 'Food & Drink'], medical: ['Bandages', 'Medkits', 'Drugs', 'Anti-radiation', 'Stimulants'], material: ['Parts', 'Chemicals', 'Mutant Parts', 'Electronics', 'Repair'], artifact: ['Gravitational', 'Chemical', 'Fire', 'Electrical', 'Miscellaneous'], ammo: ['Pistol', 'Rifle', 'Shotgun', 'Grenades'], magazine: ['Pistol', 'SMG', 'Rifle', 'Shotgun'], container: ['Pouches', 'Cases', 'Storage'], attachment: ['Optics', 'Muzzle Devices', 'Foregrips', 'Stocks', 'Tactical Devices', 'Underbarrel'], misc: ['Valuables', 'Documents', 'Keys', 'Junk'] };
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
      <label class="field wide" ...${tipProps('Explicit compatibility keys, e.g. picatinny, ak-dovetail, thread-7.62x39. Attachments must list one of these.')}>Accepted interfaces<input value=${m.interfaces.join(', ')} onInput=${e => setMount(sel, { interfaces: list(e.target.value) })} /></label>
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
  const section = (key, label, init) => html`<label class="row small"><input type="checkbox" checked=${!!d[key]} onChange=${e => setD({ ...d, [key]: e.target.checked ? init : undefined })} /> ${label}</label>`;
  return html`<div class="col">
    <div class="row"><h2 class="grow">${d.name || 'New item'}</h2><button class="primary" onClick=${save}>Save definition</button><button onClick=${() => run('def.duplicate', { id: def.id }, { ok: 'Duplicated' })}>Duplicate</button>
      <button class="danger" onClick=${async () => { if (await confirmBox('Delete definition', `Delete ${def.name}? Only possible when no instances exist.`)) run('def.delete', { id: def.id }); }}>Delete</button></div>
    <div class="cols c2">
      <${Panel} title="General"><div class="form">
        ${txt(d, setD, 'name', 'Name', '', 'wide')}
        <label class="field">Category<select value=${d.category} onChange=${e => setD({ ...d, category: e.target.value, sub: '' })}>${Object.entries(CATS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
        <label class="field">Subcategory<input list="subs" value=${d.sub} onInput=${e => setD({ ...d, sub: e.target.value })} /><datalist id="subs">${(SUBS[d.category] || []).map(s => html`<option value=${s} />`)}</datalist></label>
        ${num(d, setD, 'value', 'Value (₽)')}${num(d, setD, 'weight', 'Weight (kg)', 0.01)}${num(d, setD, 'w', 'Width (cells)')}${num(d, setD, 'h', 'Height (cells)')}${num(d, setD, 'stack', 'Stack size')}${num(d, setD, 'tier', 'Tier')}
        <label class="field">Rarity<select value=${d.rarity} onChange=${e => setD({ ...d, rarity: e.target.value })}>${['common', 'uncommon', 'rare', 'very rare', 'unique'].map(r => html`<option value=${r}>${r}</option>`)}</select></label>
        ${txt(d, setD, 'tags', 'Tags', 'Comma separated. "gm-only" hides the definition from players; "no-trade" keeps it out of generated shops.')}
        <label class="field full">Description<textarea rows="3" value=${d.description} onInput=${e => setD({ ...d, description: e.target.value })} /></label>
        <div class="full"><${ImagePicker} v=${v} value=${d.image} onChange=${id => setD({ ...d, image: id })} label="Base image (PNG)" /></div>
        <div class="field full"><span>Trader availability (empty = by category)</span><div class="row">${TRADERS.map(t => html`<label class="row small"><input type="checkbox" checked=${(d.traders || []).includes(t)} onChange=${e => setD({ ...d, traders: e.target.checked ? [...(d.traders || []), t] : d.traders.filter(x => x !== t) })} /> ${t}</label>`)}</div></div>
      </div><//>
      <${Panel} title="Behaviour"><div class="col">
        <div class="row">${section('weapon', 'Weapon', { kind: 'ranged', skill: 'Guns (Rifle)', damage: '5d pi', acc: 4, range: '500/3000', rof: '3', shots: '10+1', bulk: -5, rcl: 2, minST: 10, calibers: [], magFamilies: [], mounts: [] })}${section('magazine', 'Magazine', { family: '', capacity: 30, calibers: [] })}${section('ammo', 'Ammunition', { caliber: '' })}${section('attachment', 'Attachment', { slot: 'optic', interfaces: ['picatinny'], mods: {}, extend: { w: 0, h: 0 } })}
          ${section('armor', 'Armor', { dr: 2, locations: ['torso', 'vitals'] })}${section('container', 'Container', { grids: [{ id: 'main', label: 'Main', w: 4, h: 4 }] })}${section('consumable', 'Consumable', { heal: 1 })}${section('artifact', 'Artifact', { effects: [] })}</div>
        ${d.weapon ? html`<h3>Weapon</h3><div class="form">
          <label class="field">Kind<select value=${d.weapon.kind} onChange=${e => setD({ ...d, weapon: { ...d.weapon, kind: e.target.value } })}><option value="ranged">Ranged</option><option value="melee">Melee</option></select></label>
          ${txt(d, setD, 'weapon.skill', 'Skill', 'Exact GCS skill name, e.g. Guns (Rifle)')}${txt(d, setD, 'weapon.damage', 'Damage', 'GURPS damage, e.g. 5d+1 pi, 2d(2) pi, sw+2 cut')}
          ${d.weapon.kind === 'ranged' ? html`${num(d, setD, 'weapon.acc', 'Acc')}${txt(d, setD, 'weapon.range', 'Range (½D/Max)')}${txt(d, setD, 'weapon.rof', 'RoF')}${txt(d, setD, 'weapon.shots', 'Shots')}${num(d, setD, 'weapon.bulk', 'Bulk')}${num(d, setD, 'weapon.rcl', 'Rcl')}${num(d, setD, 'weapon.minST', 'Min ST')}
            ${txt(d, setD, 'weapon.calibers', 'Calibers (ids)', 'Caliber ids this weapon can fire, e.g. 7.62x39')}${txt(d, setD, 'weapon.magFamilies', 'Magazine families', 'Magazine family ids that fit, e.g. ak762')}
            <label class="field" ...${tipProps('Set for tube/cylinder/internal magazines; leave empty for detachable magazines.')}>Internal capacity<input type="number" value=${d.weapon.integralCap ?? d.weapon.integral?.capacity ?? ''} onInput=${e => setD({ ...d, weapon: { ...d.weapon, integralCap: e.target.value } })} /></label>` : html`${txt(d, setD, 'weapon.reach', 'Reach')}${txt(d, setD, 'weapon.parry', 'Parry')}`}
          ${txt(d, setD, 'weapon.notes', 'Notes', '', 'full')}</div>` : null}
        ${d.magazine ? html`<h3>Magazine</h3><div class="form">${txt(d, setD, 'magazine.family', 'Family id')}${num(d, setD, 'magazine.capacity', 'Capacity')}${txt(d, setD, 'magazine.calibers', 'Calibers (ids)')}</div>` : null}
        ${d.ammo ? html`<h3>Ammunition</h3><div class="form">${txt(d, setD, 'ammo.caliber', 'Caliber id')}${txt(d, setD, 'ammo.label', 'Load (FMJ/HP/AP…)')}${num(d, setD, 'ammo.divisor', 'Armor divisor', 0.5, 'HP = 0.5, AP = 2')}${num(d, setD, 'ammo.woundShift', 'Wounding size shift', 1, '+1 makes pi into pi+, etc.')}${num(d, setD, 'ammo.projectiles', 'Projectiles')}${txt(d, setD, 'ammo.damage', 'Damage override', 'e.g. 1d+1 pi for buckshot')}${txt(d, setD, 'ammo.onlyWeapons', 'Only fits weapon ids', 'Optional restriction, e.g. PMM only in the Klin')}</div>` : null}
        ${d.attachment ? html`<h3>Attachment</h3><div class="form">
          <label class="field">Mount category<select value=${d.attachment.slot} onChange=${e => setD({ ...d, attachment: { ...d.attachment, slot: e.target.value } })}>${MOUNT_SLOTS.filter(s => s !== 'magazine').map(s => html`<option value=${s}>${s}</option>`)}</select></label>
          ${txt(d, setD, 'attachment.interfaces', 'Interfaces')}${txt(d, setD, 'attachment.weapons', 'Only weapon ids', 'Optional proprietary whitelist')}
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
          <input placeholder="accepts categories" value=${(g.accepts || []).join(', ')} onInput=${e => { const gs = d.container.grids.slice(); gs[i] = { ...g, accepts: list(e.target.value) }; setD({ ...d, container: { grids: gs } }); }} /><button class="small ghost" onClick=${() => setD({ ...d, container: { grids: d.container.grids.filter((_, j) => j !== i) } })}>✕</button></div>`)}
          <button class="small" onClick=${() => setD({ ...d, container: { grids: [...d.container.grids, { id: 'g' + Date.now().toString(36), label: 'Pocket', w: 2, h: 2 }] } })}>+ Grid</button>` : null}
        ${d.consumable ? html`<h3>Consumable</h3><div class="form">${txt(d, setD, 'consumable.heal', 'HP restored', 'Number or dice, e.g. 1d')}${txt(d, setD, 'consumable.skill', 'Skill roll', 'e.g. First Aid')}${num(d, setD, 'consumable.skillMod', 'Skill modifier')}${num(d, setD, 'consumable.uses', 'Uses per item')}${num(d, setD, 'consumable.fp', 'FP restored')}${txt(d, setD, 'consumable.cures', 'Removes conditions')}</div>` : null}
        ${d.artifact ? html`<h3>Artifact</h3><label class="field">Effects (one per line)<textarea rows="3" value=${Array.isArray(d.artifact.effects) ? d.artifact.effects.join('\n') : d.artifact.effects} onInput=${e => setD({ ...d, artifact: { ...d.artifact, effects: e.target.value } })} /></label>${num(d, setD, 'artifact.radiation', 'Radiation')}` : null}
      </div><//>
    </div>
    ${d.weapon ? html`<${AnchorEditor} v=${v} d=${d} setD=${setD} />` : null}
    ${d.weapon ? html`<${Panel} title="Preconfigured variant images (fallback when overlays lack art)">
      ${(d.variants || []).map((x, i) => html`<div class="row"><input placeholder="mount=defId, …" value=${Object.entries(x.requires || {}).map(([k, val]) => `${k}=${val}`).join(', ')} onInput=${e => { const vs = d.variants.slice(); vs[i] = { ...x, requires: Object.fromEntries(list(e.target.value).map(p => p.split('=').map(s => s.trim()))) }; setD({ ...d, variants: vs }); }} style=${{ width: '320px' }} /><${ImagePicker} v=${v} value=${x.image} onChange=${id => { const vs = d.variants.slice(); vs[i] = { ...x, image: id }; setD({ ...d, variants: vs }); }} label="" /><button class="small ghost" onClick=${() => setD({ ...d, variants: d.variants.filter((_, j) => j !== i) })}>✕</button></div>`)}
      <button class="small" onClick=${() => setD({ ...d, variants: [...(d.variants || []), { requires: {}, image: '' }] })}>+ Variant</button><//>` : null}
  </div>`;
}

export function Catalog({ v }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useLocal('cat-filter', '');
  const [sel, setSel] = useLocal('cat-sel', null);
  const [spawnTo, setSpawnTo] = useState('');
  const defs = Object.values(v.defs).filter(d => (!cat || d.category === cat) && `${d.name} ${d.sub} ${d.id}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.category.localeCompare(b.category) || (a.sub || '').localeCompare(b.sub || '') || a.name.localeCompare(b.name));
  const d = v.defs[sel] || defs[0];
  const groups = {};
  for (const x of defs) (groups[`${CATS[x.category]} › ${x.sub || 'Other'}`] ||= []).push(x);
  const targets = [...Object.values(v.characters).map(c => ['char:' + c.id, c.name]), ...Object.values(v.stashes).map(s => ['stash:' + s.id, s.name]), ...Object.values(v.traders).map(t => ['trader:' + t.id, 'Trader: ' + t.name])];
  const exportCatalog = () => { const blob = new Blob([JSON.stringify(Object.values(v.defs), null, 1)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'catalog.json'; a.click(); };
  const importCatalog = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.onchange = async () => { try { const data = JSON.parse(await inp.files[0].text()); const r = await run('def.import', { defs: Array.isArray(data) ? data : data.defs || Object.values(data) }, { ok: true }); for (const e of r?.result?.errors || []) toast(e, 'error'); } catch (e) { toast(e.message, 'error'); } }; inp.click(); };
  return html`<div class="cols" style=${{ gridTemplateColumns: '330px 1fr' }}>
    <div class="col"><${Panel} title=${`Catalog (${Object.keys(v.defs).length})`} flat=${true} actions=${html`<button class="small primary" onClick=${async () => { const r = await run('def.save', { def: { name: 'New item', category: cat || 'misc', w: 1, h: 1 } }); if (r) setSel(r.result.id); }}>+ New</button>`}>
      <div class="col" style=${{ padding: '6px' }}><input class="search" placeholder="Search…" value=${q} onInput=${e => setQ(e.target.value)} />
        <select value=${cat} onChange=${e => setCat(e.target.value)}><option value="">All categories</option>${Object.entries(CATS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
        <div class="row"><button class="small" onClick=${importCatalog}>Import JSON…</button><button class="small" onClick=${exportCatalog}>Export JSON</button></div>
        <div class="row"><button class="small" onClick=${async () => { if (await confirmBox('Load starter catalog', 'Add the built-in items (Tier 1 weapons, magazines, ammo, armor, medical, artifacts, attachments, containers), crafting recipes and NPC template gear? Items you already have are kept.', 'Load')) run('def.loadStarter', {}, { ok: true }); }}>Load starter catalog</button>
          <button class="small danger" disabled=${!Object.keys(v.defs).length} onClick=${async () => { if (await confirmBox('Remove unused items', 'Delete every catalog item that no character, NPC, stash or trader currently owns? Items in use are kept. Recipes and NPC gear that refer to removed items are cleaned up.', 'Remove')) run('def.deleteUnused', {}, { ok: true }); }}>Remove unused items</button></div></div>
      <div class="scroll h-lg">${Object.entries(groups).map(([g, items]) => html`<div class="grid-label" style=${{ padding: '0 8px' }}>${g}</div>${items.map(x => html`<div class="list-item ${d?.id === x.id ? 'sel' : ''}" onClick=${() => setSel(x.id)}>
        ${M.imageUrl(v, x.image) ? html`<img src=${M.imageUrl(v, x.image)} style=${{ width: '46px', height: '24px', objectFit: 'contain' }} />` : html`<span style=${{ width: '46px' }} class="dim tiny">${x.w}×${x.h}</span>`}<span class="grow small">${x.name}</span><span class="tiny dim">${x.value}₽</span></div>`)}`)}</div><//>
      ${d ? html`<${Panel} title="Quick spawn"><div class="row"><select value=${spawnTo} onChange=${e => setSpawnTo(e.target.value)}><option value="">Spawn into…</option>${targets.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
        <button class="small" disabled=${!spawnTo} onClick=${async () => { const n = d.stack > 1 ? await askNumber('Quantity', { value: d.stack, max: 10000 }) : 1; if (n) run('item.spawn', { defId: d.id, qty: n, to: spawnTo, loadFull: !!(d.magazine || d.weapon?.integral) }, { ok: true }); }}>Spawn</button></div><//>` : null}
    </div>
    ${d ? html`<${DefEditor} key=${d.id} v=${v} def=${d} onSaved=${setSel} />` : html`<div class="panel"><div class="body empty"><h2>The catalog is empty</h2><p>Create items with <b>+ New</b>, import a catalog JSON, or load the built-in starter catalog.</p>
      <div class="row" style=${{ justifyContent: 'center' }}><button class="primary" onClick=${async () => { const r = await run('def.save', { def: { name: 'New item', category: cat || 'misc', w: 1, h: 1 } }); if (r) setSel(r.result.id); }}>+ New item</button><button onClick=${importCatalog}>Import JSON…</button><button onClick=${() => run('def.loadStarter', {}, { ok: true })}>Load starter catalog</button></div></div></div>`}
  </div>`;
}
