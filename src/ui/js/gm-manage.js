// GM management screens: NPC Manager, Encounter Manager, Character Manager, Trader Manager,
// Campaign Manager and Settings.
import { html, useState, run, runHost, Panel, Bar, Tabs, money, signed, askText, askNumber, confirmBox, toast, fmtTime, tipProps, useLocal, openModal, Modal } from './ui.js';
import * as M from './model.js';
import { CharacterInventory, StorageView } from './inventory.js';
import { CharacterSheet } from './character.js';
import { host } from './net.js';
import { openSpawn, setSpawnTarget } from './spawn.js';
import { BreakControls } from './turns.js';

/* ======================================================= manual build editor (NPCs without GCS) */
function BuildEditor({ v, c }) {
  const b = c.build || {};
  const [skills, setSkills] = useState(null);
  if (b.source === 'gcs') return html`<div class="muted small">Build managed by GCS (${c.gcs?.fileName || 'linked file'}). Edit it in GCS.</div>`;
  const num = k => html`<label class="field">${k.toUpperCase()}<input type="number" value=${b[k]} onChange=${e => run('char.manualBuild', { id: c.id, build: { [k]: Number(e.target.value) } })} /></label>`;
  const list = skills || b.skills || [];
  return html`<div class="col">
    <div class="form">${['st', 'dx', 'iq', 'ht', 'hp', 'fp', 'will', 'per', 'basicSpeed', 'basicMove', 'dodge'].map(num)}
      <label class="field">Thrust<input value=${b.thrust || ''} onChange=${e => run('char.manualBuild', { id: c.id, build: { thrust: e.target.value } })} /></label>
      <label class="field">Swing<input value=${b.swing || ''} onChange=${e => run('char.manualBuild', { id: c.id, build: { swing: e.target.value } })} /></label>
      <label class="field" ...${tipProps('Natural DR on all locations (e.g. mutant hide).')}>Natural DR<input type="number" value=${b.naturalDR?.all || 0} onChange=${e => run('char.manualBuild', { id: c.id, build: { naturalDR: { ...b.naturalDR, all: Number(e.target.value) } } })} /></label></div>
    <h3>Skills</h3>
    ${list.map((s, i) => html`<div class="row"><input value=${s.name} onInput=${e => { const l = list.slice(); l[i] = { ...s, name: e.target.value }; setSkills(l); }} /><input placeholder="spec." value=${s.spec} onInput=${e => { const l = list.slice(); l[i] = { ...s, spec: e.target.value }; setSkills(l); }} style=${{ width: '120px' }} /><input type="number" value=${s.level} onInput=${e => { const l = list.slice(); l[i] = { ...s, level: Number(e.target.value) }; setSkills(l); }} /><button class="small ghost" onClick=${() => setSkills(list.filter((_, j) => j !== i))}>✕</button></div>`)}
    <div class="row"><button class="small" onClick=${() => setSkills([...list, { name: 'Guns', spec: 'Rifle', level: 12 }])}>+ Skill</button>${skills ? html`<button class="small primary" onClick=${async () => { await run('char.manualBuild', { id: c.id, build: { skills } }); setSkills(null); }}>Save skills</button>` : null}</div>
  </div>`;
}

function CharacterHeaderEditor({ v, c }) {
  const set = (k, val) => run('char.update', { id: c.id, [k]: val });
  return html`<div class="form">
    <label class="field">Name<input value=${c.name} onChange=${e => set('name', e.target.value)} /></label>
    <label class="field">Nickname<input value=${c.nickname || ''} onChange=${e => set('nickname', e.target.value)} /></label>
    <label class="field">Faction<input value=${c.faction || ''} onChange=${e => set('faction', e.target.value)} /></label>
    <label class="field">Rank<select value=${c.rank} onChange=${e => run('rank.award', { id: c.id, rank: Number(e.target.value) })}>${(v.settings.ranks || []).map((r, i) => html`<option value=${i + 1}>${i + 1}. ${r.name}</option>`)}</select></label>
    ${c.kind === 'pc' ? html`<label class="field">Player<select value=${c.ownerId || ''} onChange=${e => set('ownerId', e.target.value || null)}><option value="">— none —</option>${Object.values(v.players).map(p => html`<option value=${p.id}>${p.name}</option>`)}</select></label>` : html`<label class="field">Visible to players<select value=${c.hidden ? 'no' : 'yes'} onChange=${e => run('npc.reveal', { id: c.id, reveal: e.target.value === 'yes' })}><option value="no">Hidden</option><option value="yes">Revealed</option></select></label>`}
    <label class="field">Portrait<select value=${c.portrait || ''} onChange=${e => set('portrait', e.target.value || null)}><option value="">none</option>${Object.values(v.assets || {}).map(a => html`<option value=${a.id}>${a.name}</option>`)}</select></label>
    <label class="field full">GM notes (never shown to players)<textarea rows="3" value=${c.gmNotes || ''} onChange=${e => set('gmNotes', e.target.value)} /></label>
  </div>`;
}

/* ======================================================= NPC Manager */
export function NpcManager({ v, selected, setSelected }) {
  const [q, setQ] = useState('');
  const [faction, setFaction] = useState('');
  const [tab, setTab] = useLocal('npc-tab', 'details');
  const npcs = Object.values(v.characters).filter(c => c.kind === 'npc' && !c.archived && `${c.name} ${c.faction}`.toLowerCase().includes(q.toLowerCase()) && (!faction || c.faction === faction)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const factions = [...new Set(Object.values(v.characters).filter(c => c.kind === 'npc').map(c => c.faction).filter(Boolean))];
  const c = v.characters[selected]?.kind === 'npc' ? v.characters[selected] : npcs[0];
  return html`<div class="cols side">
    <div class="col">
      <${GenerateNpcs} v=${v} />
      <${Panel} title=${`NPCs (${npcs.length})`} flat=${true} actions=${html`<button class="small" onClick=${async () => { const n = await askText('New NPC name', { value: 'Stranger' }); if (n) { const r = await run('char.create', { kind: 'npc', name: n }); if (r) setSelected(r.result.id); } }}>+ New</button>`}>
        <div class="row" style=${{ padding: '6px' }}><input class="search grow" placeholder="Search…" value=${q} onInput=${e => setQ(e.target.value)} /><select value=${faction} onChange=${e => setFaction(e.target.value)}><option value="">All factions</option>${factions.map(f => html`<option value=${f}>${f}</option>`)}</select></div>
        <div class="scroll h-lg">${npcs.map(n => html`<div class="list-item ${c?.id === n.id ? 'sel' : ''}" onClick=${() => setSelected(n.id)}><span class="grow">${n.name}<br /><span class="tiny muted">${n.faction} · ${v.settings.ranks[n.rank - 1]?.name}${n.hidden ? ' · hidden' : ''}</span></span><div style=${{ width: '70px' }}><${Bar} cur=${n.session.hp} max=${n.build?.hp ?? 10} /></div></div>`)}</div><//>
    </div>
    ${c ? html`<div class="col">
      <div class="row"><h2 class="grow">${c.name}</h2><${Tabs} tabs=${[['details', 'Details'], ['inventory', 'Inventory'], ['sheet', 'Sheet']]} value=${tab} onChange=${setTab} />
        <button class="small" onClick=${() => run('npc.duplicate', { id: c.id }, { ok: true })}>Duplicate</button><button class="small" onClick=${() => run('npc.resetVitals', { id: c.id })}>Reset HP/FP</button>
        <button class="small" onClick=${() => run('template.fromCharacter', { id: c.id }, { ok: 'Template created' })}>Save as template</button>
        <button class="small danger" onClick=${async () => { if (await confirmBox('Delete NPC', `Delete ${c.name}? It goes to the trash and can be restored from the Campaign Manager.`)) run('char.delete', { id: c.id }); }}>Delete</button></div>
      ${tab === 'details' ? html`<div class="cols c2"><${Panel} title="Identity"><${CharacterHeaderEditor} v=${v} c=${c} /><//><${Panel} title="Statistics"><${BuildEditor} v=${v} c=${c} /><//></div>` : null}
      ${tab === 'inventory' ? html`<${CharacterInventory} v=${v} charId=${c.id} extraRight=${html`<${SpawnBox} v=${v} to=${'char:' + c.id} />`} />` : null}
      ${tab === 'sheet' ? html`<${CharacterSheet} v=${v} charId=${c.id} />` : null}
    </div>` : html`<div class="empty">No NPCs. Generate some from a template.</div>`}
  </div>`;
}

function GenerateNpcs({ v, encounterId }) {
  const tpls = Object.values(v.npcTemplates || {});
  const [f, setF] = useState({ templateId: tpls[0]?.id || '', count: 3, rank: '', quality: '', faction: '' });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const go = async () => {
    const r = await run('npc.generate', { templateId: f.templateId, count: Number(f.count), rank: f.rank ? Number(f.rank) : undefined, quality: f.quality || undefined, faction: f.faction || undefined, encounterId });
    if (r) { toast(r.summary, 'ok'); for (const w of r.result.warnings || []) toast(w, 'error'); }
  };
  return html`<${Panel} title="Generate NPCs"><div class="form">
    <label class="field wide">Template<select value=${f.templateId} onChange=${set('templateId')}>${tpls.map(t => html`<option value=${t.id}>${t.name} (${t.archetype || ''} ${t.faction || ''})</option>`)}</select></label>
    <label class="field">Count<input type="number" min="1" max="50" value=${f.count} onInput=${set('count')} /></label>
    <label class="field">Rank<select value=${f.rank} onChange=${set('rank')}><option value="">template</option>${v.settings.ranks.map((r, i) => html`<option value=${i + 1}>${r.name}</option>`)}</select></label>
    <label class="field">Equipment quality<select value=${f.quality} onChange=${set('quality')}><option value="">by rank</option><option value="poor">Poor</option><option value="standard">Standard</option><option value="good">Good</option><option value="elite">Elite</option></select></label>
    <label class="field">Faction<input placeholder="template" value=${f.faction} onInput=${set('faction')} /></label>
  </div><div class="row" style=${{ marginTop: '8px' }}><button class="primary" onClick=${go}>Generate${encounterId ? ' into encounter' : ''}</button><span class="tiny dim">Weapons get compatible magazines and ammunition only.</span></div><//>`;
}

/** Opens the catalog picker preset to this receiver (also remembered for the G key). */
function SpawnBox({ v, to }) {
  setSpawnTarget(to);
  return html`<button class="small primary" onClick=${() => openSpawn(v, to)} title="Spawn items from the catalog here (G)">+ Spawn item…</button>`;
}

/* ======================================================= Encounter Manager */
export function EncounterManager({ v, go }) {
  const encs = Object.values(v.encounters).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const [sel, setSel] = useLocal('enc-sel', null);
  const [showArchived, setShowArchived] = useState(false);
  const e = v.encounters[sel] || encs.find(x => x.status !== 'archived');
  const pcs = Object.values(v.characters).filter(c => c.kind === 'pc');
  const npcs = Object.values(v.characters).filter(c => c.kind === 'npc' && !c.archived);
  const create = async () => { const name = await askText('Encounter name', { value: 'New encounter' }); if (!name) return; const r = await run('enc.create', { name, participants: pcs.map(c => c.id) }); if (r) setSel(r.result.id); };
  return html`<div class="cols side">
    <${Panel} title="Encounters" flat=${true} actions=${html`<button class="small primary" onClick=${create}>+ New</button>`}>
      <label class="row small" style=${{ padding: '6px' }}><input type="checkbox" checked=${showArchived} onChange=${x => setShowArchived(x.target.checked)} /> show archived</label>
      ${encs.filter(x => showArchived || x.status !== 'archived').map(x => html`<div class="list-item ${e?.id === x.id ? 'sel' : ''}" onClick=${() => setSel(x.id)}><span class="grow">${x.name}<br /><span class="tiny muted">${x.status} · ${x.order.length} combatants${x.round ? ` · round ${x.round}` : ''}</span></span></div>`)}<//>
    ${e ? html`<div class="col">
      <div class="row"><input value=${e.name} onChange=${x => run('enc.update', { id: e.id, name: x.target.value })} style=${{ fontSize: '15px', fontWeight: 600 }} /><span class="chip">${e.status}</span>
        ${e.status !== 'active' ? html`${!e.round ? html`<label class="row small" title="NPCs begin with their first weapon in hands"><input type="checkbox" checked=${e.env.npcsDrawn !== false} onChange=${x => run('enc.update', { id: e.id, env: { npcsDrawn: x.target.checked } })} /> NPCs start with weapons drawn</label>
          <label class="row small" title="Leave off for an ambush: players must ready weapons first"><input type="checkbox" checked=${!!e.env.pcsDrawn} onChange=${x => run('enc.update', { id: e.id, env: { pcsDrawn: x.target.checked } })} /> PCs start with weapons drawn</label>` : null}
        <button class="primary" onClick=${async () => { await run('enc.start', { id: e.id }); go('gm-dash'); }}>${e.round ? 'Resume' : 'Start'} & open dashboard</button>` : html`<button class="primary" onClick=${() => go('gm-dash')}>Open dashboard</button><button onClick=${() => run('enc.end', { id: e.id })}>End</button>`}
        ${e.status === 'ended' ? html`<button onClick=${() => run('enc.archive', { id: e.id })}>Archive</button>` : null}${e.status === 'archived' ? html`<button onClick=${() => run('enc.archive', { id: e.id, restore: true })}>Restore</button>` : null}
        <button class="right" onClick=${() => runHost('tts.spawn', { charIds: e.order.filter(id => v.characters[id]?.kind === 'npc') }, { ok: 'Sent tokens to Tabletop Simulator' })} ...${tipProps('Spawn black hex tokens for this encounter’s NPCs in Tabletop Simulator (requires the TTS bridge).')}>Spawn NPC tokens in TTS</button></div>
      <div class="cols c2">
        <${Panel} title="Combatants (turn order)">
          ${e.order.map((id, i) => { const c = v.characters[id]; return c ? html`<div class="row" style=${{ padding: '3px 0' }}><span class="dim">${i + 1}</span><span class="grow">${c.name} <span class="tiny muted">${c.kind === 'npc' ? c.faction : 'PC'} · Speed ${c.build?.basicSpeed}</span></span>
            <input class="small" value=${e.combatants[id]?.side || ''} onChange=${x => run('enc.combatant', { id: e.id, charId: id, side: x.target.value })} style=${{ width: '90px' }} title="Side" />
            <button class="small ghost" disabled=${i === 0} onClick=${() => { const o = e.order.slice(); [o[i - 1], o[i]] = [o[i], o[i - 1]]; run('enc.update', { id: e.id, order: o }); }}>↑</button>
            <button class="small ghost" onClick=${() => run('enc.removeCombatant', { id: e.id, charId: id })}>✕</button></div>` : null; })}
          <div class="row" style=${{ marginTop: '8px' }}><button class="small" disabled=${!pcs.some(p => !e.combatants[p.id])} onClick=${() => run('enc.addCombatant', { id: e.id, charIds: pcs.filter(p => !e.combatants[p.id]).map(p => p.id) })}>+ All player characters</button></div>
          <div class="row" style=${{ marginTop: '4px' }}><select id="encAdd"><option value="">Add character…</option>${[...pcs, ...npcs].filter(c => !e.combatants[c.id]).map(c => html`<option value=${c.id}>${c.name} (${c.kind === 'npc' ? c.faction || 'NPC' : 'PC'})</option>`)}</select><button class="small" onClick=${() => { const id = document.getElementById('encAdd').value; if (id) run('enc.addCombatant', { id: e.id, charId: id }); }}>Add</button></div>
        <//>
        ${e.status === 'active' ? html`<${Panel} title="⏸ Break in the action"><${BreakControls} v=${v} enc=${e} /><//>` : null}
        <${GenerateNpcs} v=${v} encounterId=${e.id} />
        <${Panel} title="Environment">
          <div class="form"><label class="field">Darkness penalty<input type="number" min="0" max="10" value=${e.env.darkness || 0} onChange=${x => run('enc.update', { id: e.id, env: { darkness: Number(x.target.value) } })} /></label>
          <label class="field">Weather / obscurement<input type="number" min="0" max="10" value=${e.env.weather || 0} onChange=${x => run('enc.update', { id: e.id, env: { weather: Number(x.target.value) } })} /></label>
          <label class="field full">Notes<textarea rows="3" value=${e.env.notes || ''} onChange=${x => run('enc.update', { id: e.id, env: { notes: x.target.value } })} /></label></div>
          <div class="tiny dim">Distances, cover, posture, size and speed are set per combatant on the dashboard. Long ranges are supported without limit (SSR table extended).</div><//>
        <${Panel} title="Loot">
          ${e.order.filter(id => v.characters[id]?.kind === 'npc').map(id => { const c = v.characters[id]; const released = (e.lootReleased || []).includes(id); return html`<div class="row small"><span class="grow">${c.name} <span class="muted">(${M.owned(v, id).length} items${c.session.hp <= 0 ? ', down' : ''})</span></span><button class="small ${released ? '' : 'good'}" onClick=${() => run('enc.releaseLoot', { id: e.id, charId: id, release: !released })}>${released ? 'Lock' : 'Release loot'}</button></div>`; })}
          <div class="tiny dim">Loot stays attached to the NPC; players can only take it after you release it. Items you mark hidden stay hidden.</div><//>
      </div>
    </div>` : html`<div class="empty">Create an encounter.</div>`}
  </div>`;
}

/* ======================================================= Character Manager */
export function CharacterManager({ v, selected, setSelected }) {
  const pcs = Object.values(v.characters).filter(c => c.kind === 'pc');
  const c = v.characters[selected]?.kind === 'pc' ? v.characters[selected] : pcs[0];
  const [tab, setTab] = useLocal('cm-tab', 'sheet');
  const reqs = (v.perkRequests || []).filter(r => r.status === 'pending');
  return html`<div class="cols side">
    <div class="col"><${Panel} title="Player characters" flat=${true} actions=${html`<button class="small" onClick=${() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.onchange = async () => { try { const doc = JSON.parse(await inp.files[0].text()); const r = await run('char.importPackage', { doc }, { ok: true }); if (r) setSelected(r.result.id); } catch (e) { toast(e.message, 'error'); } }; inp.click(); }}>Import…</button><button class="small primary" onClick=${async () => { const n = await askText('Character name'); if (n) { const r = await run('char.create', { kind: 'pc', name: n }); if (r) setSelected(r.result.id); } }}>+ New</button>`}>
      ${pcs.map(p => html`<div class="list-item ${c?.id === p.id ? 'sel' : ''}" onClick=${() => setSelected(p.id)}><span class="grow">${p.name}<br /><span class="tiny muted">${v.players[p.ownerId]?.name || 'unassigned'} · ${v.settings.ranks[p.rank - 1]?.name}</span></span><div style=${{ width: '70px' }}><${Bar} cur=${p.session.hp} max=${p.build?.hp ?? 10} /></div></div>`)}<//>
      ${reqs.length ? html`<${Panel} title="Perk requests">${reqs.map(r => html`<div class="row small"><span class="grow">${M.charName(v, r.charId)}: ${v.perks[r.perkId]?.name}</span><button class="small good" onClick=${() => run('perk.grant', { charId: r.charId, perkId: r.perkId })}>Approve</button><button class="small" onClick=${() => run('perk.revoke', { charId: r.charId, perkId: r.perkId })}>Deny</button></div>`)}<//>` : null}
    </div>
    ${c ? html`<div class="col">
      <div class="row"><h2 class="grow">${c.name}</h2><${Tabs} tabs=${[['sheet', 'Sheet'], ['inventory', 'Inventory'], ['manage', 'Manage']]} value=${tab} onChange=${setTab} />
        <a href=${`/api/export-character?id=${c.id}`} download><button class="small">Export</button></a>
        <button class="small" onClick=${async () => { const r = await runHost('player.link', { playerId: c.ownerId }); if (r) window.stalkerDesktop?.openWindow ? window.stalkerDesktop.openWindow(r.url, c.name) : window.open(r.url, '_blank'); }} disabled=${!c.ownerId} ...${tipProps('Open a player window for this character on this computer (single-computer play).')}>Open player window</button></div>
      ${tab === 'sheet' ? html`<${CharacterSheet} v=${v} charId=${c.id} />` : null}
      ${tab === 'inventory' ? html`<${CharacterInventory} v=${v} charId=${c.id} extraRight=${html`<${SpawnBox} v=${v} to=${'char:' + c.id} />`} />` : null}
      ${tab === 'manage' ? html`<div class="cols c2"><${Panel} title="Identity & player"><${CharacterHeaderEditor} v=${v} c=${c} /><//>
        <div class="col"><${Panel} title="Money">
          <div class="row"><b>${money(c.session.money)}</b><button class="small" onClick=${async () => { const n = await askNumber('Give or take roubles (negative to take)', { value: 1000, min: -10000000, max: 10000000 }); if (n) run('char.money', { id: c.id, delta: n, reason: 'GM' }); }}>Adjust…</button></div><//>
        <${Panel} title="Perks">${Object.values(v.perks).map(p => html`<div class="row small"><label class="row grow"><input type="checkbox" checked=${(c.perks || []).includes(p.id)} onChange=${e => run(e.target.checked ? 'perk.grant' : 'perk.revoke', { charId: c.id, perkId: p.id })} /> ${p.name} <span class="dim">(rank ${p.minRank}+)</span></label></div>`)}
          <div class="tiny dim">Allowance: ${(c.rank - 1) * (v.settings.perkPerRank || 1)} perk(s) at ${v.settings.ranks[c.rank - 1]?.name}. Ranks are separate from GURPS character points.</div><//>
        ${c.build?.source !== 'gcs' ? html`<${Panel} title="Manual statistics"><${BuildEditor} v=${v} c=${c} /><//>` : null}
        <${Panel} title="Danger zone"><button class="danger" onClick=${async () => { if (await confirmBox('Delete character', `Delete ${c.name}? Restorable from the trash.`)) run('char.delete', { id: c.id }); }}>Delete character</button><//></div></div>` : null}
    </div>` : html`<div class="empty">No player characters yet.</div>`}
  </div>`;
}

/* ======================================================= Trader Manager */
export function TraderManager({ v }) {
  const list = Object.values(v.traders);
  const [sel, setSel] = useLocal('tr-sel', null);
  const t = v.traders[sel] || list[0];
  const pcs = Object.values(v.characters).filter(c => c.kind === 'pc');
  const [openFor, setOpenFor] = useState([]);
  const types = [['medic', 'Medic'], ['technician', 'Technician'], ['general', 'General Goods'], ['weapons', 'Weapons'], ['armor', 'Armor & Clothing'], ['equipment', 'Equipment']];
  const create = async () => { const r = await run('trader.save', { name: 'New trader', type: 'general', tier: 1 }); if (r) setSel(r.result.id); };
  return html`<div class="cols side">
    <${Panel} title="Traders" flat=${true} actions=${html`<button class="small primary" onClick=${create}>+ New</button>`}>${list.map(x => html`<div class="list-item ${t?.id === x.id ? 'sel' : ''}" onClick=${() => setSel(x.id)}><span class="grow">${x.name}<br /><span class="tiny muted">${x.type} · tier ${x.tier}${x.open ? ' · OPEN' : ''}</span></span></div>`)}<//>
    ${t ? html`<div class="col">
      <div class="cols c2">
        <${Panel} title="Trader"><div class="form">
          <label class="field">Name<input value=${t.name} onChange=${e => run('trader.save', { id: t.id, name: e.target.value })} /></label>
          <label class="field">Type<select value=${t.type} onChange=${e => run('trader.save', { id: t.id, type: e.target.value })}>${types.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select></label>
          <label class="field">Tier / quality<input type="number" min="1" max="5" value=${t.tier} onChange=${e => run('trader.save', { id: t.id, tier: Number(e.target.value) })} /></label>
          <label class="field" ...${tipProps('Multiplier on item value when players buy.')}>Buy price ×<input type="number" step="0.05" value=${t.buyMult} onChange=${e => run('trader.save', { id: t.id, buyMult: Number(e.target.value) })} /></label>
          <label class="field" ...${tipProps('Fraction of item value paid when players sell.')}>Sell price ×<input type="number" step="0.05" value=${t.sellMult} onChange=${e => run('trader.save', { id: t.id, sellMult: Number(e.target.value) })} /></label>
          <label class="field" ...${tipProps('Leave empty for unlimited trader money.')}>Trader money<input type="number" value=${t.money ?? ''} placeholder="unlimited" onChange=${e => run('trader.save', { id: t.id, money: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label class="field full">Notes<textarea rows="2" value=${t.notes} onChange=${e => run('trader.save', { id: t.id, notes: e.target.value })} /></label></div>
          <div class="row" style=${{ marginTop: '8px' }}><button class="primary" onClick=${async () => { if (!M.children(v, 'trader:' + t.id).length || await confirmBox('Generate shop', 'Replace the current stock with newly generated stock?')) run('trader.generate', { id: t.id }, { ok: true }); }}>Generate shop</button>
            <button onClick=${() => run('trader.generate', { id: t.id, options: { keepExisting: true, kinds: 5 } }, { ok: true })}>Add 5 more lines</button>
            <button class="danger right" onClick=${async () => { if (await confirmBox('Delete trader', `Delete ${t.name} and its stock?`)) run('trader.delete', { id: t.id }); }}>Delete</button></div><//>
        <${Panel} title=${t.open ? 'Shop is OPEN' : 'Open shop'}>
          <div class="col">${pcs.map(p => html`<label class="row"><input type="checkbox" checked=${t.open ? t.openFor.includes(p.id) : openFor.includes(p.id)} onChange=${e => setOpenFor(e.target.checked ? [...openFor, p.id] : openFor.filter(x => x !== p.id))} /> ${p.name}</label>`)}</div>
          <div class="row" style=${{ marginTop: '8px' }}>${t.open ? html`<button onClick=${() => run('trader.close', { id: t.id }, { ok: true })}>Close shop</button>` : html`<button class="primary" onClick=${() => run('trader.open', { id: t.id, charIds: openFor }, { ok: true })}>Open for ${openFor.length ? 'selected' : 'everyone'}</button>`}</div>
          <div class="tiny dim">Purchases are atomic: money, stock and inventory change together. Right-click stock to set a price.</div><//>
      </div>
      <${Panel} title=${`Stock (${M.children(v, 'trader:' + t.id).length} lines)`} actions=${html`<${SpawnBox} v=${v} to=${'trader:' + t.id} />`}><div class="scroll" style=${{ maxHeight: '60vh' }}><${StorageView} v=${v} parentRef=${'trader:' + t.id} prices=${v.traderPrices} /></div><//>
    </div>` : html`<div class="empty">Create a trader.</div>`}
  </div>`;
}

/* ======================================================= Campaign Manager */
export function CampaignManager({ v }) {
  const [tab, setTab] = useLocal('camp-tab', 'campaigns');
  return html`<div class="col"><${Tabs} tabs=${[['campaigns', 'Campaigns & backups'], ['players', 'Players'], ['jobs', 'Jobs'], ['stashes', 'Stashes'], ['ranks', 'Ranks & perks'], ['templates', 'NPC templates'], ['log', 'Campaign log'], ['notes', 'Notes']]} value=${tab} onChange=${setTab} />
    ${tab === 'campaigns' ? html`<${Campaigns} v=${v} />` : null}${tab === 'players' ? html`<${Players} v=${v} />` : null}${tab === 'jobs' ? html`<${Jobs} v=${v} />` : null}
    ${tab === 'stashes' ? html`<${Stashes} v=${v} />` : null}${tab === 'ranks' ? html`<${Ranks} v=${v} />` : null}${tab === 'templates' ? html`<${Templates} v=${v} />` : null}
    ${tab === 'log' ? html`<${Log} v=${v} />` : null}${tab === 'notes' ? html`<div class="cols c2"><${Panel} title="Campaign notes (shared)"><textarea rows="16" value=${v.notes} onChange=${e => run('campaign.update', { notes: e.target.value })} /><//><${Panel} title="GM notes (private)"><textarea rows="16" value=${v.gmNotes} onChange=${e => run('campaign.update', { gmNotes: e.target.value })} /><//></div>` : null}
  </div>`;
}

function Campaigns({ v }) {
  const [backups, setBackups] = useState(null);
  const [migration, setMigration] = useState(null);
  const list = v.host?.campaigns || [];
  const loadBackups = async () => setBackups(await runHost('backups'));
  const importPkg = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.stalkercampaign,.json,.gz'; inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const r = await fetch('/api/import', { method: 'POST', body: await f.arrayBuffer() }); const j = await r.json(); if (j.id) toast('Campaign imported. Open it from the list.', 'ok'); else toast(j.error || 'Import failed', 'error'); }; inp.click(); };
  const migrateUpload = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const r = await fetch('/api/migrate', { method: 'POST', body: await f.text() }); const j = await r.json(); if (j.report) setMigration(j); else toast(j.error || 'Migration failed', 'error'); }; inp.click(); };
  return html`<div class="cols c2">
    <${Panel} title="Campaigns">${list.map(c => html`<div class="row" style=${{ padding: '4px 0' }}><span class="grow">${c.name}${c.test ? html` <span class="test-badge">TEST</span>` : ''}${c.id === v.campaignId ? html` <span class="chip good">open</span>` : ''}</span>
      ${c.id !== v.campaignId ? html`<button class="small" onClick=${() => runHost('campaign.open', { id: c.id })}>Open</button><button class="small ghost" onClick=${async () => { if (await confirmBox('Delete campaign', `Permanently delete "${c.name}" and its backups?`, 'Delete')) runHost('campaign.delete', { id: c.id }); }}>Delete</button>` : null}</div>`)}
      <div class="row" style=${{ marginTop: '8px' }}><button onClick=${async () => { const n = await askText('New campaign name'); if (n) runHost('campaign.create', { name: n }); }}>+ New campaign</button><button onClick=${() => runHost('campaign.create', { name: 'Test Campaign', test: true })}>+ Test campaign</button></div>
      <div class="tiny dim">Use a test campaign to try features without touching your real campaign data.</div><//>
    <${Panel} title="Save, backup & restore">
      <div class="row"><button class="primary" onClick=${() => runHost('save', {}, { ok: 'Saved' })}>Save now (Ctrl+S)</button><button onClick=${async () => { const n = await askText('Backup label', { value: 'before session' }); if (n) { await runHost('backup', { label: n }, { ok: 'Backup created' }); loadBackups(); } }}>Named backup…</button><button onClick=${loadBackups}>Show backups</button></div>
      <div class="tiny dim">Every action is written to a journal immediately and the campaign is snapshotted automatically; after a crash the journal is replayed on the next start.</div>
      ${backups ? html`<div class="scroll h-sm">${backups.map(b => html`<div class="row small"><span class="grow mono">${b.file}</span><span class="dim">${Math.round(b.size / 1024)} KB</span><button class="small" onClick=${async () => { if (await confirmBox('Restore backup', `Restore ${b.file}? A safety backup of the current state is made first.`, 'Restore')) runHost('restore', { file: b.file }, { ok: 'Restored' }); }}>Restore</button></div>`)}</div>` : null}
      <hr style=${{ borderColor: 'var(--line)' }} />
      <div class="row"><a href="/api/export" download><button>Export campaign package</button></a><button onClick=${importPkg}>Import package…</button></div>
      <div class="tiny dim">Packages contain all campaign data and the custom images from the managed library.</div><//>
    <${Panel} title="Migrate from an earlier build">
      <div class="small muted">Converts Build 4.5 / Beta 0.8 / Unified 0.9 saves (characters, inventories, magazines, catalog, NPCs, traders) into a NEW campaign. The old save is not modified.</div>
      <div class="row" style=${{ marginTop: '6px' }}>${v.host?.legacyAvailable ? html`<button class="primary" onClick=${async () => { const r = await runHost('migrate.legacy'); if (r) setMigration(r); }}>Migrate save found on this computer</button>` : null}<button onClick=${migrateUpload}>Choose legacy save file…</button></div>
      ${migration ? html`<div class="col small" style=${{ marginTop: '8px' }}><div class="good">Created a new campaign — open it from the Campaigns list.</div>
        <details open><summary>Migrated (${migration.report.migrated.length})</summary>${migration.report.migrated.map(x => html`<div>✓ ${x}</div>`)}</details>
        <details open><summary class="warn">Warnings (${migration.report.warnings.length})</summary>${migration.report.warnings.map(x => html`<div>⚠ ${x}</div>`)}</details>
        <details open><summary class="bad">Not transferred (${migration.report.notTransferred.length})</summary>${migration.report.notTransferred.map(x => html`<div>✗ ${x}</div>`)}</details></div>` : null}<//>
    <${Panel} title="Trash">${(v.trash || []).map(t => html`<div class="row small"><span class="grow">${t.name} <span class="dim">${fmtTime(t.at)}</span></span><button class="small" onClick=${() => run('trash.restore', { id: t.id }, { ok: true })}>Restore</button></div>`)}${!(v.trash || []).length ? html`<div class="muted small">Empty.</div>` : null}<//>
  </div>`;
}

function Players({ v }) {
  return html`<${Panel} title="Players" actions=${html`<button class="small primary" onClick=${async () => { const n = await askText('Player name'); if (n) run('player.save', { name: n }); }}>+ Player</button>`}>
    <table class="t"><thead><tr><th>Player</th><th>Characters</th><th>Remote join code</th><th></th></tr></thead><tbody>
    ${Object.values(v.players).map(p => html`<tr><td><input value=${p.name} onChange=${e => run('player.save', { id: p.id, name: e.target.value })} /></td><td>${Object.values(v.characters).filter(c => c.ownerId === p.id).map(c => c.name).join(', ') || html`<span class="dim">assign in Character Manager</span>`}</td>
      <td>${p.hasCode ? html`<span class="chip good">set</span>` : html`<span class="chip">none</span>`} <button class="small" onClick=${async () => { const code = await askText(`Join code for ${p.name} (6+ characters; empty to disable remote login)`); if (code !== null) runHost('player.code', { playerId: p.id, code }, { ok: 'Join code updated' }); }}>Set…</button></td>
      <td><button class="small" onClick=${async () => { const r = await runHost('player.link', { playerId: p.id }); if (r) window.stalkerDesktop?.openWindow ? window.stalkerDesktop.openWindow(r.url, p.name) : window.open(r.url, '_blank'); }}>Open player window</button>
        <button class="small ghost" onClick=${async () => { if (await confirmBox('Remove player', `Remove ${p.name}? Their characters stay in the campaign.`)) run('player.remove', { id: p.id }); }}>Remove</button></td></tr>`)}</tbody></table>
    <div class="small muted" style=${{ marginTop: '8px' }}>Single computer: use “Open player window”. Other computers (LAN or Radmin VPN): enable hosting in Settings, then players open <span class="mono">http://&lt;your address&gt;:${v.host?.port}</span> and sign in with their join code.</div><//>`;
}

function Jobs({ v }) {
  const jobs = Object.values(v.jobs);
  const pcs = Object.values(v.characters).filter(c => c.kind === 'pc');
  return html`<div class="col"><div class="row"><button class="primary" onClick=${async () => { const t = await askText('Job title'); if (t) run('job.save', { title: t, visible: true }); }}>+ New job</button></div>
    <div class="cols c2">${jobs.map(j => html`<${Panel} title=${j.title} actions=${html`<span class="chip">${j.status}</span>`}><div class="form">
      <label class="field">Title<input value=${j.title} onChange=${e => run('job.save', { id: j.id, title: e.target.value })} /></label>
      <label class="field">Employer<input value=${j.employer} onChange=${e => run('job.save', { id: j.id, employer: e.target.value })} /></label>
      <label class="field">Status<select value=${j.status} onChange=${e => run('job.save', { id: j.id, status: e.target.value })}>${['open', 'active', 'completed', 'failed'].map(s => html`<option value=${s}>${s}</option>`)}</select></label>
      <label class="field">Visible to players<select value=${j.visible ? 'y' : 'n'} onChange=${e => run('job.save', { id: j.id, visible: e.target.value === 'y' })}><option value="y">Yes</option><option value="n">No</option></select></label>
      <label class="field full">Description<textarea rows="3" value=${j.description} onChange=${e => run('job.save', { id: j.id, description: e.target.value })} /></label>
      <div class="full">${j.objectives.map((o, i) => html`<label class="row small"><input type="checkbox" checked=${o.done} onChange=${e => { const ob = j.objectives.slice(); ob[i] = { ...o, done: e.target.checked }; run('job.save', { id: j.id, objectives: ob }); }} /> ${o.text}</label>`)}
        <button class="small" onClick=${async () => { const t = await askText('Objective'); if (t) run('job.save', { id: j.id, objectives: [...j.objectives, { text: t, done: false }] }); }}>+ Objective</button></div>
      <div class="full row">${pcs.map(p => html`<label class="row small"><input type="checkbox" checked=${j.assigned.includes(p.id)} onChange=${e => run('job.save', { id: j.id, assigned: e.target.checked ? [...j.assigned, p.id] : j.assigned.filter(x => x !== p.id) })} /> ${p.name}</label>`)}</div>
      <label class="field">Reward (₽)<input type="number" value=${j.reward.money} disabled=${j.paid} onChange=${e => run('job.save', { id: j.id, reward: { ...j.reward, money: Number(e.target.value) } })} /></label>
      <label class="field">Split<select value=${j.reward.split} disabled=${j.paid} onChange=${e => run('job.save', { id: j.id, reward: { ...j.reward, split: e.target.value } })}><option value="each">Each assigned</option><option value="split">Split between them</option></select></label>
      <label class="field full">GM notes<textarea rows="2" value=${j.gmNotes} onChange=${e => run('job.save', { id: j.id, gmNotes: e.target.value })} /></label></div>
      <div class="row" style=${{ marginTop: '6px' }}><button class="good" disabled=${j.paid} onClick=${() => run('job.pay', { id: j.id }, { ok: true })}>${j.paid ? 'Paid' : 'Pay reward'}</button><button class="small ghost right" onClick=${() => run('job.delete', { id: j.id })}>Delete</button></div><//>`)}</div></div>`;
}

function Stashes({ v }) {
  const [sel, setSel] = useState(null);
  const list = Object.values(v.stashes);
  const s = v.stashes[sel] || list[0];
  return html`<div class="cols side"><${Panel} title="Stashes & containers" flat=${true} actions=${html`<button class="small primary" onClick=${async () => { const n = await askText('Stash name', { value: 'Hidden cache' }); if (n) run('stash.save', { name: n, w: 8, h: 6, hidden: true, access: [] }); }}>+ New</button>`}>
    ${list.map(x => html`<div class="list-item ${s?.id === x.id ? 'sel' : ''}" onClick=${() => setSel(x.id)}><span class="grow">${x.name}<br /><span class="tiny muted">${x.hidden ? 'hidden' : x.access === 'all' ? 'all players' : `${(x.access || []).length} player(s)`}</span></span></div>`)}<//>
    ${s ? html`<div class="col"><${Panel} title=${s.name}><div class="form">
      <label class="field">Name<input value=${s.name} onChange=${e => run('stash.save', { id: s.id, name: e.target.value })} /></label>
      <label class="field">Width<input type="number" value=${s.grid.w} onChange=${e => run('stash.save', { id: s.id, w: Number(e.target.value) })} /></label>
      <label class="field">Height<input type="number" value=${s.grid.h} onChange=${e => run('stash.save', { id: s.id, h: Number(e.target.value) })} /></label>
      <label class="field">Hidden<select value=${s.hidden ? 'y' : 'n'} onChange=${e => run('stash.save', { id: s.id, hidden: e.target.value === 'y' })}><option value="y">Hidden</option><option value="n">Visible</option></select></label>
      <label class="field">Access<select value=${s.access === 'all' ? 'all' : 'list'} onChange=${e => run('stash.save', { id: s.id, access: e.target.value === 'all' ? 'all' : [] })}><option value="all">All players</option><option value="list">Chosen players</option></select></label></div>
      ${s.access !== 'all' ? html`<div class="row">${Object.values(v.players).map(p => html`<label class="row small"><input type="checkbox" checked=${(s.access || []).includes(p.id)} onChange=${e => run('stash.save', { id: s.id, access: e.target.checked ? [...(s.access || []), p.id] : s.access.filter(x => x !== p.id) })} /> ${p.name}</label>`)}</div>` : null}<//>
      <${Panel} title="Contents" actions=${html`<${SpawnBox} v=${v} to=${'stash:' + s.id} />`}><${StorageView} v=${v} parentRef=${'stash:' + s.id} /><//></div>` : null}</div>`;
}

function Ranks({ v }) {
  return html`<div class="cols c2"><${Panel} title="Ranks (awarded by the GM)">
    <table class="t"><thead><tr><th>#</th><th>Name</th><th>NPC skill bonus</th><th>NPC gear</th><th>Requirement</th></tr></thead><tbody>${v.settings.ranks.map((r, i) => html`<tr><td>${i + 1}</td>
      <td><input value=${r.name} onChange=${e => { const rs = structuredClone(v.settings.ranks); rs[i].name = e.target.value; run('settings.update', { ranks: rs }); }} /></td>
      <td><input type="number" value=${r.npc?.skill ?? 0} onChange=${e => { const rs = structuredClone(v.settings.ranks); rs[i].npc = { ...rs[i].npc, skill: Number(e.target.value) }; run('settings.update', { ranks: rs }); }} /></td>
      <td><select value=${r.npc?.quality} onChange=${e => { const rs = structuredClone(v.settings.ranks); rs[i].npc = { ...rs[i].npc, quality: e.target.value }; run('settings.update', { ranks: rs }); }}>${['poor', 'standard', 'good', 'elite'].map(q => html`<option value=${q}>${q}</option>`)}</select></td>
      <td><input value=${r.requirement || ''} onChange=${e => { const rs = structuredClone(v.settings.ranks); rs[i].requirement = e.target.value; run('settings.update', { ranks: rs }); }} /></td></tr>`)}</tbody></table>
    <label class="row small" style=${{ marginTop: '6px' }}>Perks per rank <input type="number" min="0" max="3" value=${v.settings.perkPerRank} onChange=${e => run('settings.update', { perkPerRank: Number(e.target.value) })} /></label><//>
    <${Panel} title="Campaign perks" actions=${html`<button class="small" onClick=${async () => { const n = await askText('Perk name'); if (n) run('perk.save', { name: n, description: '', minRank: 2 }); }}>+ Perk</button>`}>
      ${Object.values(v.perks).map(p => html`<div class="row" style=${{ marginBottom: '6px' }}><input value=${p.name} onChange=${e => run('perk.save', { ...p, name: e.target.value })} style=${{ width: '160px' }} /><input class="grow" value=${p.description} onChange=${e => run('perk.save', { ...p, description: e.target.value })} /><input type="number" min="1" max="8" value=${p.minRank} onChange=${e => run('perk.save', { ...p, minRank: Number(e.target.value) })} title="Minimum rank" /><button class="small ghost" onClick=${() => run('perk.delete', { id: p.id })}>✕</button></div>`)}<//></div>`;
}

function Templates({ v }) {
  const tpls = Object.values(v.npcTemplates);
  const [sel, setSel] = useState(null);
  const t = v.npcTemplates[sel] || tpls[0];
  const [json, setJson] = useState('');
  return html`<div class="cols side"><${Panel} title="NPC templates" flat=${true}>${tpls.map(x => html`<div class="list-item ${t?.id === x.id ? 'sel' : ''}" onClick=${() => { setSel(x.id); setJson(''); }}><span class="grow">${x.name}<br /><span class="tiny muted">${x.archetype} · ${x.faction}</span></span></div>`)}<//>
    ${t ? html`<${Panel} title=${t.name}><div class="small muted">Loadouts list weapon/armor options per slot with weights; loot lists items with chance and quantity. Edit as JSON (validated on save). Generated NPCs always get compatible magazines/ammunition.</div>
      <textarea rows="24" class="mono" value=${json || JSON.stringify({ name: t.name, archetype: t.archetype, faction: t.faction, rank: t.rank, quality: t.quality, money: t.money, build: t.build, loadout: t.loadout, loot: t.loot }, null, 2)} onInput=${e => setJson(e.target.value)} />
      <div class="row"><button class="primary" onClick=${() => { try { run('template.save', { id: t.id, template: JSON.parse(json) }, { ok: 'Template saved' }); setJson(''); } catch (e) { toast('Invalid JSON: ' + e.message, 'error'); } }} disabled=${!json}>Save</button><button class="danger" onClick=${() => run('template.delete', { id: t.id })}>Delete</button></div><//>` : null}</div>`;
}

function Log({ v }) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('all');
  const list = (v.log || []).filter(l => (only === 'all' || (only === 'override' ? l.override : l.role === only)) && l.summary.toLowerCase().includes(q.toLowerCase()));
  return html`<${Panel} title="Campaign log & audit trail" actions=${html`<input class="search" placeholder="Filter…" value=${q} onInput=${e => setQ(e.target.value)} /><${Tabs} tabs=${[['all', 'All'], ['gm', 'GM'], ['player', 'Players'], ['override', 'Overrides']]} value=${only} onChange=${setOnly} />`}>
    <div class="scroll h-lg"><table class="t"><tbody>${list.map(l => html`<tr><td class="dim tiny">${fmtTime(l.at)}</td><td>${l.who}</td><td>${l.summary}${l.override ? html` <span class="chip warn">override</span>` : ''}${l.gmOnly ? html` <span class="chip">GM only</span>` : ''}</td></tr>`)}</tbody></table></div><//>`;
}

function GmPassword() {
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  return html`<div class="row"><input type="password" placeholder="Current password" value=${cur} onInput=${e => setCur(e.target.value)} /><input type="password" placeholder="New password" value=${next} onInput=${e => setNext(e.target.value)} />
    <button disabled=${!cur || next.length < 4} onClick=${async () => { const r = await runHost('gm.password', { current: cur, next }, { ok: 'GM password changed' }); if (r) { setCur(''); setNext(''); } }}>Change GM password</button></div>`;
}

/* ======================================================= Settings */
export function Settings({ v }) {
  const r = v.settings.rules;
  const set = (k, val) => run('settings.update', { rules: { [k]: val } });
  const tog = (k, label, tip) => html`<label class="row" ...${tipProps(tip)}><input type="checkbox" checked=${!!r[k]} onChange=${e => set(k, e.target.checked)} /> ${label}</label>`;
  const [zoom, setZoom] = useLocal('zoom', 1);
  const h = v.host || {};
  return html`<div class="cols c2">
    <${Panel} title="Rules — standard GURPS 4e"><div class="col">
      ${tog('ammoEffects', 'Ammunition effects (GURPS High-Tech: hollow-point, AP, buckshot)', 'HP: piercing one size larger, armor divisor (0.5). Buckshot: multiple projectiles.')}
      ${tog('bluntTrauma', 'Blunt trauma for flexible armor (optional rule, B379)')}
      ${tog('readyRequired', 'One-second combat: weapons must be drawn into Hands (Ready maneuver, B366)', 'In combat a weapon must be in the Hands slot. Drawing takes a turn (usable next round) unless a Fast-Draw roll succeeds. The Ready slot stages magazines (2 turns), stripper clips (reload time), loose rounds (1 per turn, 2 with Fast-Draw (Ammo)) and medical items for the next turn.')}
      ${tog('enforceTurns', 'Players act only on their own turn', 'Attacks, aiming and timed actions are refused out of turn. The GM can always act.')}
      ${tog('skipDown', 'Skip dead or unconscious combatants in the turn order')}
      <div class="tiny dim">Core mechanics always follow the Basic Set: success rolls, criticals, rapid fire, active defenses, hit locations, wounding, shock, major wounds, HP/FP thresholds, encumbrance.</div></div><//>
    <${Panel} title="Campaign rules (S.T.A.L.K.E.R.) — off by default"><div class="col">
      ${tog('armorDT', 'Armor damage threshold (DT)', 'Penetrating damage at or below the armor DT causes no injury.')}
      ${tog('armorDurability', 'Armor durability points (DP)', 'Hits reduce armor DP when the GM applies the damage.')}
      ${tog('conditionAffectsDR', 'Armor condition affects DR', 'DR scales from 50% at 0 DP to 100% at full DP.')}
      ${tog('crafting', 'Crafting enabled')}</div><//>
    <${Panel} title="Players & visibility"><div class="col">
      ${tog('playerSelfAdjust', 'Players may adjust their own HP/FP', 'Needed for the “GM tells the player the injury” workflow. Players can never change NPCs.')}
      ${tog('showDamageToPlayers', 'Show applied injury numbers on NPCs to players')}
      <label class="row">NPC status shown to players <select value=${r.npcStatusToPlayers} onChange=${e => set('npcStatusToPlayers', e.target.value)}><option value="none">Nothing</option><option value="descriptive">Descriptive (Wounded, Down…)</option><option value="exact">Exact HP</option></select></label></div><//>
    <${Panel} title="Economy"><div class="form">
      <label class="field">Global price multiplier<input type="number" step="0.05" value=${v.settings.economy.priceMult} onChange=${e => run('settings.update', { economy: { priceMult: Number(e.target.value) } })} /></label>
      <label class="field">Currency symbol<input value=${v.settings.economy.currency} onChange=${e => run('settings.update', { economy: { currency: e.target.value } })} /></label>
      <label class="field">Stock lines per shop<input type="number" placeholder="auto" value=${v.settings.economy.stockKinds ?? ''} onChange=${e => run('settings.update', { economy: { stockKinds: e.target.value ? Number(e.target.value) : null } })} /></label>
      <label class="field">Autosave every (s)<input type="number" min="5" value=${v.settings.autosaveSeconds} onChange=${e => run('settings.update', { autosaveSeconds: Number(e.target.value) })} /></label></div><//>
    <${Panel} title="Multiplayer hosting"><div class="col small">
      <label class="row"><input type="checkbox" checked=${h.lan} onChange=${e => runHost('lan', { enabled: e.target.checked }, { ok: e.target.checked ? 'Hosting on the network' : 'Local only' })} /> Allow other computers to connect (LAN / Radmin VPN)</label>
      <div>Port <b>${h.port}</b>. ${h.lan ? html`Players open: ${(h.addresses || []).map(a => html`<span class="mono">http://${a.address}:${h.port}</span> <span class="dim">(${a.name})</span> `)}` : 'Currently listening on this computer only.'}</div>
      <div class="dim">Players sign in with the join code you set under Campaign → Players. The GM computer is authoritative: every transaction and HP change is validated there. Windows may ask to allow the app through the firewall.</div></div><//>
    <${Panel} title="GURPS Character Sheet"><div class="col small">
      <div>Status: ${h.gcs?.available ? html`<span class="good">found</span> <span class="mono">${h.gcs.executable}</span>${h.gcs.bundled ? ' (bundled)' : ''}` : html`<span class="warn">not found</span>`}</div>
      <div>Watching ${h.gcs?.watching?.length || 0} linked file(s).</div>
      <div class="row"><button onClick=${() => runHost('gcs.launch')} disabled=${!h.gcs?.available}>Open GCS</button>${window.stalkerDesktop?.pickGcsExe ? html`<button onClick=${async () => { const f = await window.stalkerDesktop.pickGcsExe(); if (f) runHost('gcs.setExecutable', { path: f }, { ok: 'GCS location saved' }); }}>Locate gcs.exe…</button>` : null}</div>
      <div class="dim">The complete official GCS (MPL-2.0) runs in its own native window for character creation, templates, libraries and advancement. The companion imports what GCS saves.</div></div><//>
    <${Panel} title="Tabletop Simulator (optional)"><div class="col small">
      <div class="row"><span class="status-dot ${h.tts?.reachable ? 'on' : h.tts?.enabled ? 'wait' : ''}"></span>${h.tts?.enabled ? (h.tts.reachable ? 'Connected to TTS' : 'Bridge running — TTS not reachable') : 'Bridge off'}${h.tts?.lastError ? html` <span class="warn">${h.tts.lastError}</span>` : null}</div>
      <div class="row">${h.tts?.enabled ? html`<button onClick=${() => runHost('tts.stop')}>Stop bridge</button><button onClick=${() => runHost('tts.ping')}>Test</button><button onClick=${() => runHost('tts.status', {}, { ok: 'Status sent to linked tokens' })}>Push status to tokens</button>` : html`<button class="primary" onClick=${() => runHost('tts.start')}>Start bridge</button>`}<a href="/tts/Global.lua" target="_blank">Global.lua script</a></div>
      ${h.ttsSelection ? html`<div class="notice-bar info">TTS token ${h.ttsSelection.guid || ''} ${h.ttsSelection.name || ''} ${h.ttsSelection.charId ? `→ ${M.charName(v, h.ttsSelection.charId)}` : html`<select onChange=${e => e.target.value && run('tts.link', { charId: e.target.value, guid: h.ttsSelection.guid })}><option value="">Link to…</option>${Object.values(v.characters).map(c => html`<option value=${c.id}>${c.name}</option>`)}</select>`}</div>` : null}
      <div>Linked tokens: ${Object.entries(v.tts?.links || {}).map(([g, id]) => html`<span class="chip">${g} → ${M.charName(v, id)}<button onClick=${() => run('tts.unlink', { guid: g })}>✕</button></span>`)}</div>
      <div class="dim">Paste tts/Global.lua into TTS Global script. TTS keeps maps, miniatures, movement and measuring; the companion never depends on it.</div></div><//>
    <${Panel} title="GM account"><div class="col small"><${GmPassword} /><div class="dim">Everyone opening the app sees the main menu; the GM enters with this password. Players pick a character instead.</div></div><//>
    <${Panel} title="Display"><div class="col small"><label class="row"><input type="checkbox" checked=${localStorage.getItem('sgc:chime') !== 'false'} onChange=${e => localStorage.setItem('sgc:chime', String(e.target.checked))} /> Sound when it is your turn / an NPC's turn</label><label class="row">Interface scale <input type="range" min="0.75" max="1.5" step="0.05" value=${zoom} onInput=${e => { setZoom(Number(e.target.value)); document.documentElement.style.setProperty('--zoom', e.target.value); }} /> ${Math.round(zoom * 100)}%</label>
      <div>Shortcuts: <span class="kbd">1–9</span> pages · <span class="kbd">Ctrl+S</span> save · <span class="kbd">N</span> next turn · <span class="kbd">A</span> apply · <span class="kbd">J/K</span> queue · <span class="kbd">R</span> rotate (also while dragging) · <span class="kbd">Q</span> quick-load · <span class="kbd">Del</span> delete item (GM)</div></div><//>
  </div>`;
}
