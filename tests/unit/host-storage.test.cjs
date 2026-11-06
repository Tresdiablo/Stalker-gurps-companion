'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { Host } = require('../../src/server/host');
const { CampaignStore } = require('../../src/server/storage');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sgc-')); }

test('storage: journal survives an abnormal shutdown and is replayed', () => {
  const dir = tmp();
  const store = new CampaignStore(dir);
  const id = store.create({ name: 'Crash test', test: true });
  const oc = store.open(id);
  const gm = { role: 'gm' };
  const pc = oc.engine.dispatch('char.create', { name: 'Survivor', kind: 'pc' }, gm).result.id;
  oc.engine.dispatch('char.adjust', { id: pc, hp: -3 }, gm);
  // simulate a crash: no close(), no snapshot — only the journal is on disk
  clearInterval(oc.timer);
  const store2 = new CampaignStore(dir);
  const oc2 = store2.open(id);
  assert.equal(oc2.recovery.crashed, true);
  assert.equal(oc2.recovery.replayed, 2);
  assert.equal(oc2.state.characters[pc].session.hp, 7);
  oc2.close();
  const oc3 = new CampaignStore(dir).open(id);
  assert.equal(oc3.recovery.crashed, false);
  assert.equal(oc3.state.characters[pc].session.hp, 7);
  // backups and restore
  const b = oc3.backup('before-session');
  oc3.engine.dispatch('char.adjust', { id: pc, hp: -5 }, gm);
  oc3.restore(b);
  assert.equal(oc3.state.characters[pc].session.hp, 7);
  // torn final journal line is ignored
  oc3.engine.dispatch('char.adjust', { id: pc, hp: -1 }, gm);
  clearInterval(oc3.timer);
  fs.appendFileSync(path.join(dir, 'campaigns', id, 'journal.ndjson'), '{"seq":99999,"action":"char.adj');
  const oc4 = new CampaignStore(dir).open(id);
  assert.equal(oc4.state.characters[pc].session.hp, 6);
  assert.equal(oc4.recovery.skipped, 1);
  // export / import package
  const pkg = new CampaignStore(dir).exportPackage(id, oc4.state);
  const newId = new CampaignStore(dir).importPackage(pkg);
  assert.notEqual(newId, id);
  oc4.close();
});

test('host: GM and player clients over WebSocket; permissions enforced on the server; live updates', async () => {
  const host = new Host({ dataDir: tmp(), port: 0, log: { error() {} } });
  await host.start();
  const base = `http://127.0.0.1:${host.port}`;
  // GM session via one-time redirect cookie
  const r = await fetch(`${base}/?gm=${host.gmToken}`, { redirect: 'manual' });
  const gmCookie = r.headers.get('set-cookie').split(';')[0];
  const gm = await client(host.port, gmCookie);
  const pid = (await gm.call('action', { action: 'player.save', payload: { name: 'Ivan' } })).result.id;
  await gm.host('player.code', { playerId: pid, code: 'secret-123' });
  const pc = (await gm.call('action', { action: 'char.create', payload: { name: 'Stalker Ivan', kind: 'pc', ownerId: pid } })).result.id;
  const npc = (await gm.call('action', { action: 'char.create', payload: { name: 'Bandit 1', kind: 'npc' } })).result.id;
  // player login with join code
  const bad = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ playerId: pid, code: 'nope' }) });
  assert.equal(bad.status, 403);
  const ok = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ playerId: pid, code: 'secret-123' }) });
  const plCookie = ok.headers.get('set-cookie').split(';')[0];
  const pl = await client(host.port, plCookie);
  await pl.waitView(v => v.role === 'player' && v.characters[pc]);
  assert.ok(!pl.view.characters[npc], 'hidden NPC not visible');
  const denied = await pl.call('action', { action: 'char.adjust', payload: { id: npc, hp: -5 } });
  assert.equal(denied.ok, false);
  const denied2 = await pl.call('host', { command: 'backup' });
  assert.equal(denied2.ok, false);
  const gmOnly = await fetch(`${base}/api/export`, { headers: { cookie: plCookie } });
  assert.equal(gmOnly.status, 403);
  // a GM change reaches the player promptly
  await gm.call('action', { action: 'char.adjust', payload: { id: pc, hp: -2 } });
  await pl.waitView(v => v.characters[pc]?.session.hp === 8);
  // a player roll reaches the GM promptly
  const roll = await pl.call('action', { action: 'roll.skill', payload: { actorId: pc, skill: 'DX' }, requestId: 'r1' });
  assert.equal(roll.ok, true);
  await gm.waitView(v => v.events[roll.eventId]?.kind === 'skill');
  const again = await pl.call('action', { action: 'roll.skill', payload: { actorId: pc, skill: 'DX' }, requestId: 'r1' });
  assert.equal(again.duplicate, true);
  const unauth = await fetch(`${base}/api/export`);
  assert.equal(unauth.status, 401);
  gm.close(); pl.close();
  await host.stop();
});

function client(port, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie } });
    const pending = new Map(); let n = 0; const waiters = [];
    const c = { view: null, close: () => ws.close(),
      call: (type, body) => new Promise(res => { const reqId = ++n; pending.set(reqId, res); ws.send(JSON.stringify({ type, reqId, ...body })); }),
      host: (command, payload) => c.call('host', { command, payload }),
      waitView: pred => new Promise((res, rej) => { if (c.view && pred(c.view)) return res(c.view); const t = setTimeout(() => rej(new Error('timeout waiting for view')), 3000); waiters.push({ pred, res: v => { clearTimeout(t); res(v); } }); }) };
    ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'result') { pending.get(m.reqId)?.(m); pending.delete(m.reqId); } if (m.type === 'view') { c.view = m.view; for (const w of waiters.splice(0)) { if (w.pred(c.view)) w.res(c.view); else waiters.push(w); } } });
    ws.on('open', () => resolve(c));
    ws.on('error', reject);
  });
}

test('host allows at most 8 people at once (GM + 7 players); extra windows of one person count once', async () => {
  const host = new Host({ dataDir: tmp(), port: 0, log: { error() {} } });
  await host.start();
  const base = `http://127.0.0.1:${host.port}`;
  const gmCookie = (await fetch(`${base}/?gm=${host.gmToken}`, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const gm = await client(host.port, gmCookie);
  const cookies = [];
  for (let i = 0; i < 8; i++) {
    const id = (await gm.call('action', { action: 'player.save', payload: { name: 'P' + i } })).result.id;
    await gm.host('player.code', { playerId: id, code: 'code-' + i });
    const r = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ playerId: id, code: 'code-' + i }) });
    if (i < 7) {
      assert.equal(r.status, 200);
      const cookie = r.headers.get('set-cookie').split(';')[0];
      cookies.push({ cookie, c: await client(host.port, cookie) });
    } else {
      assert.equal(r.status, 403, '8th player refused at login');
      assert.match((await r.json()).error, /full/);
    }
  }
  await gm.waitView(v => v.host.online.length === 8);
  // a second window of an already-connected player is fine
  const extra = await client(host.port, cookies[0].cookie);
  await new Promise(r => setTimeout(r, 100));
  assert.equal(host.online().size, 8);
  // a 9th person is refused at the WebSocket too (session minted before the room filled)
  cookies[6].c.close();
  await new Promise(r => setTimeout(r, 100));
  const id9 = (await gm.call('action', { action: 'player.save', payload: { name: 'Late' } })).result.id;
  const t9 = host.playerLink(id9);
  const ck9 = (await fetch(t9, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const reopen = await client(host.port, cookies[6].cookie); // seat 7 taken again
  await new Promise(r => setTimeout(r, 100));
  const closed = await new Promise(res => { const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws`, { headers: { cookie: ck9 } }); ws.on('close', code => res(code)); });
  assert.equal(closed, 4001);
  assert.equal(gm.view.host.maxPeople, 8);
  for (const x of cookies) x.c.close(); extra.close(); reopen.close(); gm.close();
  await host.stop();
});
