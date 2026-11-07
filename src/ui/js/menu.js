// Main menu: the first screen of every window that is not signed in. Choose a character to play
// (characters someone else is playing are locked) or enter the GM password.
import { html, useState, useEffect } from './ui.js';
import { menu, gmLogin, joinAs } from './net.js';

export function MainMenu() {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [pw, setPw] = useState('');
  const [codes, setCodes] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => menu().then(x => { if (alive) setInfo(x); }).catch(() => alive && setErr('Cannot reach the host. Is the GM’s app running?'));
    load();
    const t = setInterval(load, 3000); // keep "being played" locks current
    return () => { alive = false; clearInterval(t); };
  }, []);
  const enterGm = async () => {
    setBusy(true); setErr('');
    try { await gmLogin(pw); try { sessionStorage.removeItem('sgc:started'); } catch { /* ignore */ } location.reload(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const join = async c => {
    setBusy(true); setErr('');
    try { await joinAs(c.id, codes[c.id]); try { sessionStorage.setItem('sgc:started', '1'); } catch { /* ignore */ } location.reload(); }
    catch (e) { setErr(e.message); setBusy(false); if (e.data?.needsCode) setCodes(x => ({ ...x, [c.id]: x[c.id] || '' })); }
  };
  const chars = info?.characters || [];
  const full = info && info.online >= info.maxPeople;
  return html`<div class="start">
    <div class="start-hero">
      <div class="start-title">S.T.A.L.K.E.R. <span class="dim">/</span> GURPS</div>
      <div class="start-sub">MAIN MENU${info ? ` · ${info.campaign.toUpperCase()}` : ''}</div>
    </div>
    <div class="menu-body">
      <div class="start-card">
        <h3>Play as</h3>
        ${chars.length ? html`<div class="menu-chars">${chars.map(c => {
          const locked = !!c.playedBy;
          return html`<div class="menu-char ${locked ? 'locked' : ''}" key=${c.id}>
            ${c.portrait ? html`<img src=${c.portrait} class="portrait" />` : html`<div class="portrait menu-initial">${c.name.slice(0, 1)}</div>`}
            <div class="grow"><b>${c.name}</b><div class="tiny muted">${[c.rank, c.faction].filter(Boolean).join(' · ')}</div><div class="tiny">HP ${c.hp}/${c.maxHp}</div>
              ${locked ? html`<div class="tiny warn">🔒 Being played by ${c.playedBy}</div>` : null}
              ${!locked && (c.needsCode || codes[c.id] !== undefined) ? html`<input type="password" placeholder="Join code" value=${codes[c.id] || ''} onInput=${e => setCodes({ ...codes, [c.id]: e.target.value })} onKeyDown=${e => e.key === 'Enter' && join(c)} style=${{ marginTop: '4px' }} />` : null}</div>
            <button class="primary" disabled=${locked || busy || (full && !locked)} onClick=${() => join(c)}>${locked ? 'In use' : 'Play'}</button>
          </div>`;
        })}</div>` : html`<div class="muted">No characters yet. The GM creates them under Characters.</div>`}
      </div>
      <div class="start-card primary-card">
        <h3>Game Master</h3>
        <label class="field">GM password<input type="password" value=${pw} onInput=${e => setPw(e.target.value)} onKeyDown=${e => e.key === 'Enter' && enterGm()} autofocus /></label>
        <button class="primary big" disabled=${busy || !pw} onClick=${enterGm}>Enter as GM ▶</button>
        <div class="tiny dim">The GM password can be changed in Settings.</div>
      </div>
    </div>
    ${err ? html`<div class="notice-bar">${err}</div>` : null}
    ${info ? html`<div class="tiny dim">${info.online} / ${info.maxPeople} people connected${full ? ' — the session is full' : ''}</div>` : null}
  </div>`;
}
