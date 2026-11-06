// Start screen shown when a window opens. GM: choose or create a campaign. Player: pick a
// character and see who is online. Leaving it is remembered for this window only.
import { html, useState, runHost, askText, confirmBox, toast, money } from './ui.js';
import * as M from './model.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function Online({ v }) {
  const on = v.host?.online || [];
  const max = v.host?.maxPeople || 8;
  return html`<div class="start-online"><h3>Online · ${on.length} / ${max}</h3>
    <div class="row">${on.map(p => html`<span class="chip ${p.role === 'gm' ? 'warn' : 'info'}"><span class="status-dot on"></span>${p.name}</span>`)}</div>
    <div class="tiny dim" style=${{ marginTop: '4px' }}>Up to ${max} people at once (the GM plus ${max - 1} players). Several windows of the same person count once.</div></div>`;
}

export function StartScreen({ v, onEnter }) {
  const gm = v.role === 'gm';
  return html`<div class="start">
    <div class="start-hero">
      <div class="start-title">S.T.A.L.K.E.R. <span class="dim">/</span> GURPS</div>
      <div class="start-sub">CAMPAIGN COMPANION · GURPS 4TH EDITION</div>
    </div>
    ${gm ? html`<${GmStart} v=${v} onEnter=${onEnter} />` : html`<${PlayerStart} v=${v} onEnter=${onEnter} />`}
    <div class="start-foot"><${Online} v=${v} /></div>
  </div>`;
}

function GmStart({ v, onEnter }) {
  const list = (v.host?.campaigns || []).slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const [busy, setBusy] = useState(false);
  const open = async id => {
    if (id !== v.campaignId) { setBusy(true); const r = await runHost('campaign.open', { id }); setBusy(false); if (r === null) return; }
    onEnter();
  };
  const create = async test => {
    const name = await askText(test ? 'Test campaign name' : 'New campaign name', { value: test ? 'Test Campaign' : 'S.T.A.L.K.E.R. Campaign' });
    if (!name) return;
    setBusy(true); const r = await runHost('campaign.create', { name, test }); setBusy(false);
    if (r) onEnter();
  };
  const importPkg = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.stalkercampaign,.json,.gz'; inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const r = await fetch('/api/import', { method: 'POST', body: await f.arrayBuffer() }); const j = await r.json(); if (j.id) { await runHost('campaign.open', { id: j.id }); onEnter(); } else toast(j.error || 'Import failed', 'error'); }; inp.click(); };
  const migrate = async () => { if (!(await confirmBox('Migrate old save', 'Create a new campaign from the previous build’s save on this computer? The old save is not changed.', 'Migrate'))) return; const r = await runHost('migrate.legacy'); if (r) { await runHost('campaign.open', { id: r.id }); toast(`Migrated: ${r.report.migrated.length} entries, ${r.report.warnings.length} warnings, ${r.report.notTransferred.length} not transferred — see Campaign → Migrate for the report.`, 'ok'); onEnter(); } };
  const current = list.find(c => c.id === v.campaignId);
  return html`<div class="start-body">
    <div class="start-card primary-card">
      <h3>Continue</h3>
      <div class="start-camp">${v.name}${v.test ? html` <span class="test-badge">TEST</span>` : ''}</div>
      <div class="muted small">${plural(Object.values(v.characters).filter(c => c.kind === 'pc').length, 'character')} · ${plural(Object.values(v.characters).filter(c => c.kind === 'npc').length, 'NPC')} · ${plural(Object.keys(v.defs).length, 'catalog item')} · ${Object.values(v.encounters).filter(e => e.status === 'active').length ? 'encounter in progress' : 'no active encounter'}</div>
      <button class="primary big" disabled=${busy} onClick=${() => onEnter()}>Enter campaign ▶</button>
    </div>
    <div class="start-card">
      <h3>Campaigns</h3>
      <div class="start-list">${list.map(c => html`<div class="list-item ${c.id === current?.id ? 'sel' : ''}" onClick=${() => open(c.id)}>
        <span class="grow">${c.name}${c.test ? html` <span class="test-badge">TEST</span>` : ''}<br /><span class="tiny dim">${c.updatedAt ? new Date(c.updatedAt).toLocaleString() : ''}</span></span><span class="muted small">${c.id === current?.id ? 'open' : 'Open ▸'}</span></div>`)}</div>
      <div class="row" style=${{ marginTop: '8px' }}><button disabled=${busy} onClick=${() => create(false)}>+ New campaign</button><button disabled=${busy} onClick=${() => create(true)}>+ Test campaign</button><button onClick=${importPkg}>Import package…</button>${v.host?.legacyAvailable ? html`<button onClick=${migrate}>Migrate old save</button>` : null}</div>
    </div>
    <div class="start-card">
      <h3>Before the session</h3>
      <ul class="small start-tips">
        <li>${Object.values(v.players).length} player${Object.values(v.players).length === 1 ? '' : 's'} set up — add players and join codes under <b>Campaign → Players</b>.</li>
        <li>${v.host?.lan ? html`Hosting for other computers: ${(v.host.addresses || []).map(a => html`<span class="mono">http://${a.address}:${v.host.port}</span> `)}` : html`Only this computer can connect. Turn on hosting in <b>Settings</b> for LAN / Radmin VPN.`}</li>
        <li>GCS: ${v.host?.gcs?.available ? html`<span class="good">ready</span>` : html`<span class="warn">not found</span> — run the Windows setup or locate gcs.exe in Settings`}. Tabletop Simulator bridge: ${v.host?.tts?.enabled ? (v.host.tts.reachable ? html`<span class="good">connected</span>` : 'running, TTS not reachable') : 'off'}.</li>
        ${!Object.keys(v.defs).length ? html`<li class="warn">The item catalog is empty — add items in <b>Item Catalog</b> (or load the starter catalog there).</li>` : null}
      </ul>
    </div>
  </div>`;
}

function PlayerStart({ v, onEnter }) {
  const mine = M.myChars(v);
  return html`<div class="start-body" style=${{ gridTemplateColumns: 'minmax(300px, 440px)' }}>
    <div class="start-card primary-card">
      <h3>Welcome, ${v.playerName}</h3>
      <div class="start-camp">${v.name}</div>
      ${mine.length ? html`<div class="start-list">${mine.map(c => html`<div class="list-item" onClick=${() => onEnter(c.id)}>
        <span class="grow"><b>${c.name}</b><br /><span class="tiny muted">${v.settings?.ranks?.[c.rank - 1]?.name || ''} · HP ${c.session.hp}/${c.build?.hp} · ${money(c.session.money)}</span></span><span class="muted small">Play ▸</span></div>`)}</div>`
        : html`<div class="muted">The GM has not given you a character yet. You can still look around.</div><button class="primary big" onClick=${() => onEnter()}>Enter ▶</button>`}
    </div>
  </div>`;
}
