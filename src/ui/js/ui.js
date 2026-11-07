// Shared UI primitives: toasts, context menus, modals, tooltips, floating windows, helpers.
import { html, render, useState, useEffect, useRef } from '../vendor/htm-preact-standalone.js';
import { act, host, conn } from './net.js';
export { html, useState, useEffect, useRef };

/* ----------------------------------------------------------- toasts */
let toastList = [], toastRender = () => {};
export function toast(text, kind = 'info') {
  const id = Math.random();
  toastList = [...toastList, { id, text, kind }].slice(-6);
  toastRender();
  setTimeout(() => { toastList = toastList.filter(t => t.id !== id); toastRender(); }, kind === 'error' ? 6500 : 3500);
}
export function Toasts() {
  const [, force] = useState(0);
  useEffect(() => { toastRender = () => force(x => x + 1); }, []);
  return html`<div class="toasts">${toastList.map(t => html`<div class="toast ${t.kind}" key=${t.id}>${t.text}</div>`)}</div>`;
}

/** Run an action and toast errors. Returns the result or null. */
export async function run(action, payload, { ok } = {}) {
  try { const r = await act(action, payload); if (ok) toast(typeof ok === 'string' ? ok : r.summary, 'ok'); return r; }
  catch (e) { toast(e.message, 'error'); return null; }
}
export async function runHost(cmd, payload, { ok } = {}) {
  try { const r = await host(cmd, payload); if (ok) toast(ok, 'ok'); return r.result; }
  catch (e) { toast(e.message, 'error'); return null; }
}

/**
 * Interface scale (Settings → Interface scale) is a CSS zoom on <body>. Mouse coordinates are in
 * screen pixels, but positions inside the body are in zoomed pixels, so divide by this factor.
 */
export function zf() { return parseFloat(getComputedStyle(document.body).zoom) || 1; }

/* ----------------------------------------------------------- context menu */
let menuState = null, menuRender = () => {};
/** items: [{label, onClick, disabled, hint, sub:[...]}, '-', {header}] */
export function openMenu(ev, items) {
  ev.preventDefault(); ev.stopPropagation();
  const z = zf();
  const x = Math.min(ev.clientX / z, window.innerWidth / z - 230), y = Math.min(ev.clientY / z, window.innerHeight / z - 30 * Math.min(items.length, 14));
  menuState = { x, y, items: items.filter(Boolean) };
  menuRender();
}
export function closeMenu() { if (menuState) { menuState = null; menuRender(); } }
function MenuList({ items }) {
  const [openSub, setOpenSub] = useState(-1);
  return html`${items.map((it, i) => {
    if (it === '-') return html`<div class="sep"></div>`;
    if (it.header) return html`<div class="hd">${it.header}</div>`;
    const dis = it.disabled || (it.sub && !it.sub.length);
    return html`<div class="it ${dis ? 'dis' : ''}" title=${it.title || ''} onMouseEnter=${() => setOpenSub(it.sub ? i : -1)}
      onClick=${e => { e.stopPropagation(); if (dis || it.sub) return; closeMenu(); it.onClick?.(); }}>
      <span>${it.label}</span><span class="dim">${it.sub ? '▸' : it.hint || ''}</span>
      ${it.sub && openSub === i && !dis ? html`<div class="ctx sub"><${MenuList} items=${it.sub} /></div>` : null}
    </div>`;
  })}`;
}
export function ContextMenu() {
  const [, force] = useState(0);
  useEffect(() => {
    menuRender = () => force(x => x + 1);
    const close = () => closeMenu();
    window.addEventListener('click', close); window.addEventListener('blur', close);
    const esc = e => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', esc); };
  }, []);
  if (!menuState) return null;
  return html`<div class="ctx" style=${{ left: menuState.x + 'px', top: menuState.y + 'px' }} onContextMenu=${e => e.preventDefault()}><${MenuList} items=${menuState.items} /></div>`;
}

/* ----------------------------------------------------------- modals */
let modalStack = [], modalRender = () => {};
export function openModal(render) { return new Promise(resolve => { modalStack = [...modalStack, { render, resolve }]; modalRender(); }); }
function closeTop(value) { const m = modalStack[modalStack.length - 1]; modalStack = modalStack.slice(0, -1); modalRender(); m?.resolve(value); }
export function Modals() {
  const [, force] = useState(0);
  useEffect(() => { modalRender = () => force(x => x + 1); const esc = e => { if (e.key === 'Escape' && modalStack.length) closeTop(null); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, []);
  return html`${modalStack.map((m, i) => html`<div class="modal-back" key=${i} onMouseDown=${e => { if (e.target === e.currentTarget) closeTop(null); }}>${m.render(closeTop)}</div>`)}`;
}
export function Modal({ title, children, footer, wide }) {
  return html`<div class="modal" style=${wide ? { minWidth: '720px' } : null}><header><h2>${title}</h2></header><div class="body">${children}</div>${footer ? html`<footer>${footer}</footer>` : null}</div>`;
}
/** Ask for a number. */
export function askNumber(title, { value = 1, min = 1, max = 9999, label = 'Amount' } = {}) {
  return openModal(close => html`<${NumberAsk} close=${close} title=${title} value=${value} min=${min} max=${max} label=${label} />`);
}
function NumberAsk({ close, title, value, min, max, label }) {
  const [v, setV] = useState(value);
  const ok = () => { const n = Number(v); if (Number.isFinite(n) && n >= min && n <= max) close(n); };
  return html`<${Modal} title=${title} footer=${html`<button onClick=${() => close(null)}>Cancel</button><button class="primary" onClick=${ok}>OK</button>`}>
    <div class="row"><label class="field">${label}<input type="number" autofocus value=${v} min=${min} max=${max} onInput=${e => setV(e.target.value)} onKeyDown=${e => e.key === 'Enter' && ok()} /></label>
    <input type="range" min=${min} max=${max} value=${v} onInput=${e => setV(e.target.value)} style=${{ flex: 1 }} /><span class="muted">${min}–${max}</span></div>
  <//>`;
}
export function askText(title, { value = '', label = 'Text', multiline = false } = {}) {
  return openModal(close => html`<${TextAsk} close=${close} title=${title} value=${value} label=${label} multiline=${multiline} />`);
}
function TextAsk({ close, title, value, label, multiline }) {
  const [v, setV] = useState(value);
  return html`<${Modal} title=${title} footer=${html`<button onClick=${() => close(null)}>Cancel</button><button class="primary" onClick=${() => close(v)}>OK</button>`}>
    <label class="field">${label}${multiline ? html`<textarea rows="6" value=${v} onInput=${e => setV(e.target.value)} />` : html`<input autofocus value=${v} onInput=${e => setV(e.target.value)} onKeyDown=${e => e.key === 'Enter' && close(v)} />`}</label><//>`;
}
export function confirmBox(title, text, okLabel = 'Confirm') {
  return openModal(close => html`<${Modal} title=${title} footer=${html`<button onClick=${() => close(false)}>Cancel</button><button class="primary" onClick=${() => close(true)}>${okLabel}</button>`}><p>${text}</p><//>`);
}

/* ----------------------------------------------------------- tooltips (title-free, multi-line) */
let tipState = null, tipRender = () => {};
export function tipProps(text) {
  if (!text) return {};
  return { onMouseEnter: e => { tipState = { text, x: e.clientX, y: e.clientY }; tipRender(); }, onMouseMove: e => { if (tipState) { tipState.x = e.clientX; tipState.y = e.clientY; tipRender(); } }, onMouseLeave: () => { tipState = null; tipRender(); } };
}
export function Tooltip() {
  const [, force] = useState(0);
  useEffect(() => { tipRender = () => force(x => x + 1); window.addEventListener('pointerdown', () => { tipState = null; tipRender(); }); }, []);
  if (!tipState) return null;
  const z = zf();
  const x = Math.min(tipState.x / z + 14, window.innerWidth / z - 370), y = Math.min(tipState.y / z + 16, window.innerHeight / z - 140);
  return html`<div class="tip" style=${{ left: x + 'px', top: y + 'px' }}>${tipState.text}</div>`;
}

/* ----------------------------------------------------------- floating windows */
export function FloatWin({ title, x = 120, y = 120, w = 360, onClose, children }) {
  const ref = useRef();
  const [pos, setPos] = useState({ x, y });
  const down = e => {
    const z = zf();
    const sx = e.clientX / z - pos.x, sy = e.clientY / z - pos.y;
    const move = ev => setPos({ x: Math.max(0, ev.clientX / z - sx), y: Math.max(0, ev.clientY / z - sy) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return html`<div class="float-win" ref=${ref} style=${{ left: pos.x + 'px', top: pos.y + 'px', width: w + 'px' }}>
    <header onPointerDown=${down}><h3 class="grow">${title}</h3><button class="small ghost" onClick=${onClose}>✕</button></header><div class="body">${children}</div></div>`;
}

/* ----------------------------------------------------------- small components */
export function Bar({ cur, max, kind = 'hp' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  const cls = cur <= 0 ? 'crit' : cur <= max / 3 ? 'low' : '';
  return html`<div class="bar ${kind} ${cls}"><i style=${{ width: pct + '%' }}></i><span>${cur} / ${max}</span></div>`;
}
export function Panel({ title, actions, children, flat, cls = '' }) {
  return html`<section class="panel ${flat ? 'flat' : ''} ${cls}"><header><h2 class="grow">${title}</h2>${actions}</header><div class="body">${children}</div></section>`;
}
export function Field({ label, children, cls = '' }) { return html`<label class="field ${cls}">${label}${children}</label>`; }
export function Dice({ dice }) { return html`<span class="dice">${(dice || []).map(d => html`<span class="die">${d}</span>`)}</span>`; }
export function signed(n) { return (n > 0 ? '+' : '') + n; }
export function fmtTime(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } }
export function money(n) { return `${Number(n || 0).toLocaleString()} ${conn.view?.settings?.economy?.currency || '₽'}`; }
export function Tabs({ tabs, value, onChange }) {
  return html`<div class="tabs">${tabs.map(([k, label]) => html`<button class=${value === k ? 'active' : ''} onClick=${() => onChange(k)}>${label}</button>`)}</div>`;
}
export function useLocal(key, initial) {
  const [v, setV] = useState(() => { try { const x = localStorage.getItem('sgc:' + key); return x === null ? initial : JSON.parse(x); } catch { return initial; } });
  const set = nv => { setV(old => { const val = typeof nv === 'function' ? nv(old) : nv; try { localStorage.setItem('sgc:' + key, JSON.stringify(val)); } catch { /* ignore */ } return val; }); };
  return [v, set];
}
export function mount(App, el) { render(html`<${App} />`, el); }
/** Render a vnode into a detached element (drag ghosts). */
export function renderInto(vnode, el) { render(vnode, el); }
