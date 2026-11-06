// Character sheet built from the GCS file (GCS-calculated values), session state and the GCS
// synchronization controls. Building/editing a character happens in the full GCS application.
import { html, useState, run, runHost, Panel, signed, toast, tipProps, fmtTime, money, confirmBox } from './ui.js';
import * as M from './model.js';
import { Vitals } from './combat.js';

function StatBox({ label, value, onRoll, tip }) {
  return html`<div class="stat ${onRoll ? 'rollable' : ''}" onClick=${onRoll} ...${tipProps(tip || (onRoll ? `Roll ${label}` : ''))}><b>${value ?? '—'}</b><small>${label}</small></div>`;
}

async function pickGcsFile(v, c) {
  if (window.stalkerDesktop?.pickGcsFile) {
    const file = await window.stalkerDesktop.pickGcsFile();
    if (file) return runHost('gcs.link', { charId: c.id, path: file }, { ok: 'Linked to GCS file. Changes saved in GCS now sync automatically.' });
    return;
  }
  // browser / remote player: upload the file contents (one-time import; no live link)
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.gcs';
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const text = await f.text(); run('char.importGcs', { id: c.id, text, fileName: f.name, force: true }, { ok: true }); };
  inp.click();
}

export function GcsPanel({ v, c }) {
  const gm = v.role === 'gm';
  const desktop = !!window.stalkerDesktop;
  const g = c.gcs;
  const status = v.host?.gcs;
  return html`<${Panel} title="GURPS Character Sheet (GCS)" actions=${html`<span class="chip ${c.build?.source === 'gcs' ? 'good' : ''}">${c.build?.source === 'gcs' ? 'GCS-managed' : 'not linked'}</span>`}>
    <div class="col small">
      <div class="muted">GCS is the authority for the build (attributes, traits, skills, points). Edit the character in GCS and save — the companion imports GCS's own calculated values. The companion never writes to .gcs files; it tracks session state (current HP/FP, conditions, inventory) itself.</div>
      ${g?.path ? html`<div>Linked file: <span class="mono">${g.path}</span> · sync <b>${g.sync}</b>${g.importedAt ? ` · last import ${fmtTime(g.importedAt)}` : ''}</div>` : g?.fileName ? html`<div>Imported from <span class="mono">${g.fileName}</span> (one-time upload${g.importedAt ? `, ${fmtTime(g.importedAt)}` : ''})</div>` : null}
      ${g?.vitalsNote ? html`<div class="notice-bar">${g.vitalsNote} <button class="small" onClick=${() => run('char.useGcsVitals', { id: c.id }, { ok: true })}>Use GCS values instead</button></div>` : null}
      <div class="row">
        ${gm && status?.available ? html`<button class="primary" onClick=${() => runHost('gcs.launch', { charId: c.id })}>${g?.path ? 'Edit in GCS' : 'Open GCS'}</button>` : null}
        ${gm && !status?.available ? html`<span class="warn">GCS not found — install with the Windows setup or locate gcs.exe in Settings.</span>` : null}
        <button onClick=${() => pickGcsFile(v, c)}>${desktop && gm ? (g?.path ? 'Change linked file…' : 'Link .gcs file…') : 'Import .gcs file…'}</button>
        ${gm && g?.path ? html`<button onClick=${() => runHost('gcs.sync', { charId: c.id, force: true }, { ok: 'Re-imported from GCS' })}>Sync now</button>
          <button onClick=${() => run('char.gcsLink', { id: c.id, sync: g.sync === 'paused' ? 'auto' : 'paused' })}>${g.sync === 'paused' ? 'Resume sync' : 'Pause sync'}</button>
          <button class="ghost" onClick=${() => runHost('gcs.unlink', { charId: c.id })}>Unlink</button>` : null}
      </div>
      ${g?.lastChanges?.length ? html`<details><summary>Changes in last import (${g.lastChanges.length})</summary>${g.lastChanges.slice(0, 60).map(x => html`<div class="mono tiny">${x.field}: ${x.from ?? '—'} → ${x.to ?? 'removed'}</div>`)}</details>` : null}
      ${c.build?.warnings?.length ? c.build.warnings.map(w => html`<div class="warn">⚠ ${w}</div>`) : null}
    </div><//>`;
}

export function CharacterSheet({ v, charId }) {
  const c = v.characters[charId];
  const [q, setQ] = useState('');
  if (!c) return html`<div class="empty">No character selected.</div>`;
  const b = c.build || {};
  const canRoll = v.role === 'gm' || c.mine;
  const roll = skill => canRoll && run('roll.skill', { actorId: c.id, skill, visibility: v.role === 'gm' ? 'gm' : 'public' });
  const traits = (b.traits || []).filter(t => !t.container);
  const groups = { advantage: 'Advantages', perk: 'Perks', disadvantage: 'Disadvantages', quirk: 'Quirks', feature: 'Features' };
  const skills = (b.skills || []).filter(s => `${s.name} ${s.spec}`.toLowerCase().includes(q.toLowerCase()));
  const pts = b.points || {};
  const rankName = v.settings?.ranks?.[c.rank - 1]?.name || `Rank ${c.rank}`;
  return html`<div class="page">
    <div class="cols" style=${{ gridTemplateColumns: '340px 1fr 1fr' }}>
      <div class="col">
        <${Panel} title=${c.name} actions=${html`<span class="chip info">${rankName}</span>`}>
          <div class="row nowrap" style=${{ alignItems: 'flex-start' }}>${c.portrait && M.imageUrl(v, c.portrait) ? html`<img class="portrait" src=${M.imageUrl(v, c.portrait)} />` : null}
            <div class="small col" style=${{ gap: '2px' }}>${b.profile?.title ? html`<div>${b.profile.title}</div>` : null}<div class="muted">${c.faction || 'No faction'}${b.profile?.player ? ` · player ${b.profile.player}` : ''}</div>
            <div class="muted">${[b.profile?.age && `Age ${b.profile.age}`, b.profile?.height, b.profile?.weight, b.profile?.techLevel && `TL${b.profile.techLevel}`].filter(Boolean).join(' · ')}</div><div>${money(c.session.money)}</div></div></div>
          <hr style=${{ borderColor: 'var(--line)' }} /><${Vitals} v=${v} c=${c} />
        <//>
        <${GcsPanel} v=${v} c=${c} />
        ${c.perks?.length || v.perks ? html`<${Panel} title="Rank perks">${(c.perks || []).map(id => html`<div><b>${v.perks?.[id]?.name || id}</b> <span class="muted small">${v.perks?.[id]?.description || ''}</span></div>`)}
          ${!c.perks?.length ? html`<div class="muted small">No perks yet. Ranks are awarded by the GM; each rank can unlock one campaign perk with GM approval.</div>` : null}
          ${c.mine ? html`<div class="row" style=${{ marginTop: '6px' }}><select id="perkReq"><option value="">Request a perk…</option>${Object.values(v.perks || {}).filter(p => !(c.perks || []).includes(p.id)).map(p => html`<option value=${p.id}>${p.name} (rank ${p.minRank}+)</option>`)}</select><button class="small" onClick=${() => { const id = document.getElementById('perkReq').value; if (id) run('perk.request', { charId: c.id, perkId: id }, { ok: 'Request sent to the GM' }); }}>Request</button></div>` : null}<//>` : null}
      </div>
      <div class="col">
        <${Panel} title="Attributes" actions=${html`<span class="muted small" ...${tipProps('Character points from GCS (spent is recomputed from the file).')}>${pts.total ?? '—'} pts${pts.unspent ? ` · ${pts.unspent} unspent` : ''}</span>`}>
          <div class="stat-box">
            <${StatBox} label="ST" value=${b.st} onRoll=${() => roll('ST')} /><${StatBox} label="DX" value=${b.dx} onRoll=${() => roll('DX')} /><${StatBox} label="IQ" value=${b.iq} onRoll=${() => roll('IQ')} /><${StatBox} label="HT" value=${b.ht} onRoll=${() => roll('HT')} />
            <${StatBox} label="Will" value=${b.will} onRoll=${() => roll('Will')} /><${StatBox} label="Per" value=${b.per} onRoll=${() => roll('Per')} /><${StatBox} label="HP" value=${b.hp} /><${StatBox} label="FP" value=${b.fp} />
            <${StatBox} label="Speed" value=${b.basicSpeed} /><${StatBox} label="Move" value=${c.derived?.move ?? b.basicMove} tip="Encumbrance-adjusted Move" /><${StatBox} label="Dodge" value=${c.derived?.dodge ?? b.dodge} tip="Encumbrance-adjusted Dodge (GCS value per encumbrance level when linked)" /><${StatBox} label="Lift" value=${c.derived?.basicLiftKg ? c.derived.basicLiftKg + 'kg' : '—'} />
            <${StatBox} label="Thrust" value=${c.derived?.thrust || b.thrust} /><${StatBox} label="Swing" value=${c.derived?.swing || b.swing} />
          </div>
          ${pts.total !== null && pts.total !== undefined ? html`<div class="small muted" style=${{ marginTop: '6px' }}>Attributes ${pts.attributes} · Advantages ${pts.advantages} · Perks ${pts.perks} · Disadvantages ${pts.disadvantages} · Quirks ${pts.quirks} · Skills ${pts.skills}${pts.spells ? ` · Spells ${pts.spells}` : ''}</div>` : null}
        <//>
        <${Panel} title="Traits">${Object.entries(groups).map(([k, l]) => { const list = traits.filter(t => t.kind === k); return list.length ? html`<h3 style=${{ marginTop: '6px' }}>${l}</h3>${list.map(t => html`<div class="row small ${t.disabled ? 'dim' : ''}" ...${tipProps(t.notes || t.reference || '')}><span class="grow">${t.name}${t.level ? ` ${t.level}` : ''}</span><span class="mono muted">${t.points}</span></div>`)}` : null; })}
          ${!traits.length ? html`<div class="empty">No traits recorded.</div>` : null}<//>
        ${(b.weapons || []).length ? html`<${Panel} title="Weapons on the sheet (GCS)"><table class="t"><thead><tr><th>Weapon</th><th>Lvl</th><th>Damage</th><th>Parry/Acc</th><th>Range</th><th>RoF</th></tr></thead><tbody>${b.weapons.map(w => html`<tr><td>${w.owner}${w.usage ? ` (${w.usage})` : ''}</td><td>${w.level ?? ''}</td><td>${w.damage}</td><td>${w.kind === 'melee' ? w.parry : w.acc}</td><td>${w.range || w.reach}</td><td>${w.rof}</td></tr>`)}</tbody></table><div class="tiny dim">Inventory weapons (with tracked ammunition) are listed on the Combat page.</div><//>` : null}
      </div>
      <div class="col">
        <${Panel} title="Skills" actions=${html`<input class="search" placeholder="Search…" value=${q} onInput=${e => setQ(e.target.value)} />`}>
          <div class="scroll" style=${{ maxHeight: '520px' }}><table class="t"><thead><tr><th>Skill</th><th>Level</th><th>RSL</th><th>Pts</th><th></th></tr></thead><tbody>
            ${skills.map(s => html`<tr><td>${s.name}${s.spec ? ` (${s.spec})` : ''}${s.technique ? html` <span class="chip">tech</span>` : ''}</td><td class="mono"><b>${s.level ?? '—'}</b></td><td class="mono dim">${s.rsl}</td><td class="mono dim">${s.points}</td><td>${canRoll && s.level !== null ? html`<button class="small" onClick=${() => roll(s.spec ? `${s.name} (${s.spec})` : s.name)}>Roll</button>` : null}</td></tr>`)}
          </tbody></table>${!skills.length ? html`<div class="empty">No skills.</div>` : null}</div><//>
        ${(b.spells || []).length ? html`<${Panel} title="Spells">${b.spells.map(sp => html`<div class="row small"><span class="grow">${sp.name}</span><span class="mono">${sp.level}</span></div>`)}<//>` : null}
        <${Panel} title="Notes">${(b.notes || []).map(n => html`<p class="small" style=${{ whiteSpace: 'pre-wrap' }}>${n}</p>`)}
          ${c.mine || v.role === 'gm' ? html`<label class="field">Session notes (companion)<textarea rows="5" value=${c.session.notes || ''} onChange=${e => run('char.update', { id: c.id, notes: e.target.value })} /></label>` : null}<//>
        ${(b.equipment || []).length ? html`<${Panel} title="Equipment listed in GCS"><div class="scroll h-sm">${b.equipment.map(e => html`<div class="small" style=${{ paddingLeft: e.depth * 12 + 'px' }}>${e.equipped ? '' : '(not equipped) '}${e.name}${e.qty > 1 ? ` ×${e.qty}` : ''} <span class="dim">${e.weightKg ? e.weightKg.toFixed(2) + ' kg' : ''}</span></div>`)}</div><div class="tiny dim">Reference only — physical items, ammunition and condition are tracked in the companion inventory.</div><//>` : null}
      </div>
    </div>
  </div>`;
}
