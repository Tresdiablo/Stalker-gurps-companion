// Application shell: login, navigation, routing and global shortcuts.
import { html, useState, useEffect, mount, Toasts, ContextMenu, Modals, Tooltip, runHost, useLocal, tipProps, toast } from './ui.js';
import { conn, subscribe, start, whoami, login } from './net.js';
import * as M from './model.js';
import { CharacterInventory } from './inventory.js';
import { CharacterSheet } from './character.js';
import { WeaponWorkbench } from './equipment.js';
import { PlayerCombat } from './combat.js';
import { PlayerDashboard, PlayerTrader, PlayerCrafting } from './player.js';
import { GmDashboard } from './gm-dashboard.js';
import { NpcManager, EncounterManager, CharacterManager, TraderManager, CampaignManager, Settings } from './gm-manage.js';
import { Catalog } from './gm-catalog.js';
import { StartScreen } from './start.js';

const PLAYER_PAGES = [['dash', 'Dashboard'], ['character', 'Character / GCS'], ['inventory', 'Inventory'], ['equipment', 'Equipment'], ['combat', 'Combat'], ['trader', 'Trader'], ['crafting', 'Crafting / Jobs']];
const GM_PAGES = [['gm-dash', 'GM Dashboard'], ['encounters', 'Encounters'], ['npcs', 'NPC Manager'], ['characters', 'Characters'], ['catalog', 'Item Catalog'], ['traders', 'Traders'], ['campaign', 'Campaign'], ['settings', 'Settings']];

function useView() {
  const [, force] = useState(0);
  useEffect(() => { const off = subscribe(() => force(x => x + 1)); force(x => x + 1); return off; }, []);
  return conn;
}

function Login() {
  const [info, setInfo] = useState(null);
  const [pid, setPid] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { whoami().then(setInfo).catch(() => setErr('Cannot reach the host.')); }, []);
  const go = async () => { try { await login(pid || info.players[0]?.id, code); location.reload(); } catch (e) { setErr(e.message); } };
  return html`<div class="login panel"><header><h2>S.T.A.L.K.E.R. / GURPS — join campaign</h2></header><div class="body col">
    <div class="muted">${info?.campaign || ''}${info ? ` · ${info.online}/${info.maxPeople} people online` : ''}</div>
    ${info?.players?.length ? html`<label class="field">Player<select value=${pid} onChange=${e => setPid(e.target.value)}>${info.players.map(p => html`<option value=${p.id}>${p.name}</option>`)}</select></label>
      <label class="field">Join code<input type="password" value=${code} onInput=${e => setCode(e.target.value)} onKeyDown=${e => e.key === 'Enter' && go()} /></label>
      <button class="primary" onClick=${go}>Join</button>` : html`<div class="muted">No player can join remotely yet. The GM sets join codes under Campaign → Players.</div>`}
    ${err ? html`<div class="bad">${err}</div>` : null}
    <div class="tiny dim">The GM opens the companion on the host computer; this page is for players on other computers.</div></div></div>`;
}

function App() {
  const c = useView();
  const v = c.view;
  const gm = v?.role === 'gm';
  const [page, setPage] = useLocal('page', gm ? 'gm-dash' : 'dash');
  const [charSel, setCharSel] = useLocal('char-sel', null);
  const [selected, setSelected] = useState(null);
  const [weaponId, setWeaponId] = useState(null);
  const [mode, setMode] = useLocal('mode', 'gm'); // GM can switch to the player-style pages for any PC
  const [started, setStarted] = useState(() => { try { return sessionStorage.getItem('sgc:started') === '1'; } catch { return false; } });
  const enter = charId => { if (charId) setCharSel(charId); try { sessionStorage.setItem('sgc:started', '1'); } catch { /* ignore */ } setStarted(true); };
  const toStart = () => { try { sessionStorage.removeItem('sgc:started'); } catch { /* ignore */ } setStarted(false); };
  useEffect(() => {
    const zoom = Number(localStorage.getItem('sgc:zoom') || 1); document.documentElement.style.setProperty('--zoom', zoom);
    const key = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (conn.view?.role === 'gm') runHost('save', {}, { ok: 'Saved' }); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { const s = document.querySelector('.search'); if (s) { e.preventDefault(); s.focus(); } }
      if (e.target.matches('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9) { const pages = conn.view?.role === 'gm' && localStorage.getItem('sgc:mode') !== '"player"' ? GM_PAGES : PLAYER_PAGES; if (pages[n - 1]) setPage(pages[n - 1][0]); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { const notes = conn.view?.host?.notes || []; const last = notes[notes.length - 1]; if (last && last.id !== window.__lastNote) { if (window.__lastNote !== undefined || last.kind === 'recovery') toast(last.text, last.kind === 'recovery' ? 'ok' : 'info'); window.__lastNote = last.id; } });
  if (c.status === 'full') return html`<div class="login panel"><header><h2>Session full</h2></header><div class="body col"><div>${c.full || 8} people are already connected (the GM plus ${(c.full || 8) - 1} players). You will be let in automatically when someone leaves.</div><div class="tiny dim">Retrying every 10 seconds…</div></div></div>`;
  if (c.status === 'unauthorized' && !v) return html`<${Login} />`;
  if (!v) return html`<div class="boot">S.T.A.L.K.E.R. / GURPS — ${c.status === 'offline' ? 'host offline, retrying…' : 'connecting…'}</div>`;

  const mine = M.myChars(v);
  const charId = (mine.find(x => x.id === charSel) || mine[0])?.id || null;
  const playerMode = !gm || mode === 'player';
  const pages = playerMode ? PLAYER_PAGES : GM_PAGES;
  const cur = pages.some(p => p[0] === page) ? page : pages[0][0];
  const go = p => { if (gm && PLAYER_PAGES.some(x => x[0] === p)) setMode('player'); if (gm && GM_PAGES.some(x => x[0] === p)) setMode('gm'); setPage(p); };
  const pending = gm ? Object.values(v.events).filter(M.needsGm).length : Object.values(v.events).filter(e => (e.stage === 'awaiting-defense' && v.characters[e.targetId]?.mine) || (e.notifications || []).some(n => !n.applied) || (e.kind === 'request' && e.stage === 'pending')).length;

  let body;
  switch (cur) {
    case 'dash': body = html`<${PlayerDashboard} v=${v} charId=${charId} go=${go} />`; break;
    case 'character': body = html`<${CharacterSheet} v=${v} charId=${charId} />`; break;
    case 'inventory': body = html`<${CharacterInventory} v=${v} charId=${charId} customize=${id => { setWeaponId(id); setPage('equipment'); }} />`; break;
    case 'equipment': body = html`<${WeaponWorkbench} v=${v} charId=${charId} weaponId=${weaponId} setWeaponId=${setWeaponId} />`; break;
    case 'combat': body = html`<${PlayerCombat} v=${v} charId=${charId} />`; break;
    case 'trader': body = html`<${PlayerTrader} v=${v} charId=${charId} />`; break;
    case 'crafting': body = html`<${PlayerCrafting} v=${v} charId=${charId} />`; break;
    case 'gm-dash': body = html`<${GmDashboard} v=${v} selected=${selected} setSelected=${setSelected} />`; break;
    case 'encounters': body = html`<${EncounterManager} v=${v} go=${go} />`; break;
    case 'npcs': body = html`<${NpcManager} v=${v} selected=${selected} setSelected=${setSelected} />`; break;
    case 'characters': body = html`<${CharacterManager} v=${v} selected=${selected} setSelected=${setSelected} />`; break;
    case 'catalog': body = html`<${Catalog} v=${v} />`; break;
    case 'traders': body = html`<${TraderManager} v=${v} />`; break;
    case 'campaign': body = html`<${CampaignManager} v=${v} />`; break;
    case 'settings': body = html`<${Settings} v=${v} />`; break;
    default: body = null;
  }
  const tts = v.host?.tts;
  if (!started) return html`<div><${StartScreen} v=${v} onEnter=${enter} /><${Toasts} /><${Modals} /><${ContextMenu} /><${Tooltip} /></div>`;
  const online = v.host?.online || [];
  return html`<div class="shell">
    <div class="topbar">
      <div class="brand" style=${{ cursor: 'pointer' }} onClick=${toStart} title="Back to the start screen">S.T.A.L.K.E.R. / GURPS<small>COMPANION</small></div>
      <span class="campaign-name">${v.name}</span>${v.test ? html`<span class="test-badge">TEST CAMPAIGN</span>` : null}
      <span class="grow"></span>
      ${mine.length && playerMode ? html`<label class="row small">Character <select value=${charId || ''} onChange=${e => setCharSel(e.target.value)}>${mine.map(x => html`<option value=${x.id}>${x.name}</option>`)}</select></label>` : null}
      ${gm ? html`<div class="tabs"><button class=${!playerMode ? 'active' : ''} onClick=${() => { setMode('gm'); setPage('gm-dash'); }}>Game Master</button><button class=${playerMode ? 'active' : ''} onClick=${() => { setMode('player'); setPage('inventory'); }} ...${tipProps('View any player character through the player pages (GM permissions still apply).')}>Player view</button></div>` : html`<span class="chip info">${v.playerName}</span>`}
      <span class="chip ${online.length >= (v.host?.maxPeople || 8) ? 'warn' : ''}" ...${tipProps(`Connected now:\n${online.map(p => p.name).join('\n') || '—'}\nLimit: ${v.host?.maxPeople || 8} people (GM included)`)}>👥 ${online.length}/${v.host?.maxPeople || 8}</span>
      <span class="row small" ...${tipProps(`Host: ${c.status}${gm ? `\nTabletop Simulator: ${tts?.enabled ? (tts.reachable ? 'connected' : 'not reachable') : 'off'}${v.host?.lan ? `\nHosting for other computers on port ${v.host.port}` : ''}` : ''}`)}><span class="status-dot ${c.status === 'online' ? 'on' : 'off'}"></span>${gm ? html`<span>TTS</span><span class="status-dot ${tts?.reachable ? 'on' : tts?.enabled ? 'wait' : ''}"></span>` : null}</span>
    </div>
    <nav class="nav">${pages.map(([k, l], i) => html`<button class=${cur === k ? 'active' : ''} onClick=${() => go(k)} title=${`Shortcut ${i + 1}`}>${l}${(k === 'gm-dash' || k === 'combat') && pending ? html`<span class="badge">${pending}</span>` : null}</button>`)}</nav>
    <main class="main">${c.status !== 'online' ? html`<div class="notice-bar" style=${{ marginBottom: '10px' }}>Connection to the host lost — reconnecting. Actions will be retried safely.</div>` : null}${body}</main>
    <${Toasts} /><${ContextMenu} /><${Modals} /><${Tooltip} />
  </div>`;
}

start();
mount(App, document.getElementById('app'));
