'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TtsBridge, luaString } = require('../../src/server/tts-bridge');
const { GcsService } = require('../../src/server/gcs-service');
const { setup } = require('./helpers.cjs');

test('TTS bridge sends Lua to the External Editor port and receives custom messages', async () => {
  const received = [];
  const fakeTts = net.createServer(sock => { let b = ''; sock.on('data', d => { b += d; }); sock.on('end', () => received.push(JSON.parse(b))); });
  await new Promise(r => fakeTts.listen(0, '127.0.0.1', r));
  const messages = [];
  const bridge = new TtsBridge({ sendPort: fakeTts.address().port, listenPort: 0, onMessage: m => messages.push(m) });
  const ok = await bridge.call('spawn', { tokens: [{ npcId: 'npc_1', name: 'Bandit ]] 1' }] });
  assert.equal(ok, true);
  await new Promise(r => setTimeout(r, 50));
  const last = received[received.length - 1];
  assert.equal(last.messageID, 3);
  assert.equal(last.guid, '-1');
  assert.match(last.script, /stalkerCompanion\.spawn\(JSON\.decode\(\[=+\[/);
  bridge.receive(JSON.stringify({ messageID: 4, customMessage: { type: 'select', guid: 'abc123' } }));
  assert.deepEqual(messages[0], { type: 'select', guid: 'abc123' });
  assert.equal(luaString('a]]b'), '[=[a]]b]=]'); assert.equal(luaString('a]=]b'), '[==[a]=]b]==]');
  fakeTts.close();
  // not running -> clear error, no crash
  const offline = new TtsBridge({ sendPort: 1 });
  assert.equal(await offline.ping(), false);
  assert.match(offline.status().lastError, /not running|ECONN|refused/i);
});

test('GCS service watches a linked file and delivers new saves; never writes it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcs-'));
  const file = path.join(dir, 'Ivan.gcs');
  const v1 = JSON.stringify({ version: 5, profile: { name: 'Ivan' }, attributes: [{ attr_id: 'st', calc: { value: 10 } }] });
  fs.writeFileSync(file, v1);
  const got = [];
  const svc = new GcsService({ configFile: path.join(dir, 'cfg.json'), onChange: (id, text) => got.push([id, text]) });
  svc.watch('pc_1', file);
  await new Promise(r => setTimeout(r, 1100));
  const v2 = JSON.stringify({ version: 5, profile: { name: 'Ivan' }, attributes: [{ attr_id: 'st', calc: { value: 11 } }] });
  fs.writeFileSync(file + '.tmp', v2); fs.renameSync(file + '.tmp', file); // GCS-style atomic save
  await new Promise(r => setTimeout(r, 2600));
  svc.close();
  assert.equal(got.length >= 1, true, 'change delivered');
  assert.equal(got[got.length - 1][0], 'pc_1');
  assert.match(got[got.length - 1][1], /"value":11/);
  assert.equal(fs.readFileSync(file, 'utf8'), v2, 'file untouched by the companion');
  assert.throws(() => svc.read(path.join(dir, 'x.txt')), /\.gcs/);
});

test('GCS import keeps session HP, reports changes and conflicts, and is blocked for other players', () => {
  const { engine, gm, player, pc } = setup();
  const doc = (st, hp, skill) => JSON.stringify({ version: 5, total_points: 150, profile: { name: 'Stalker Ivan' }, attributes: [{ attr_id: 'st', calc: { value: st, points: 0 } }, { attr_id: 'dx', calc: { value: 12, points: 40 } }, { attr_id: 'hp', calc: { value: hp, current: hp, points: 0 } }, { attr_id: 'fp', calc: { value: 10, current: 10 } }], skills: [{ id: 's1', name: 'Guns', specialization: 'Rifle', difficulty: 'dx/e', points: 4, calc: { level: skill, rsl: 'DX+2' } }], traits: [{ id: 't1', name: 'High Pain Threshold', base_points: 10, calc: { points: 10 }, tags: ['Advantage'] }], calc: { dodge: [9, 8, 7, 6, 5], move: [6, 4, 3, 2, 1], swing: '1d+1', thrust: '1d-1' } });
  let r = engine.dispatch('char.importGcs', { id: pc, text: doc(11, 11, 14), fileName: 'Ivan.gcs' }, player);
  const c = () => engine.state.characters[pc];
  assert.equal(c().build.source, 'gcs');
  assert.equal(c().session.hp, 11);
  assert.equal(c().build.flags.highPainThreshold, true);
  engine.dispatch('char.adjust', { id: pc, hp: -4 }, gm);
  r = engine.dispatch('char.importGcs', { id: pc, text: doc(12, 12, 15), fileName: 'Ivan.gcs' }, player);
  assert.equal(c().build.hp, 12);
  assert.equal(c().session.hp, 8, 'damage preserved across re-import (12 - 4)');
  assert.ok(r.result.changes.some(x => x.field === 'skill:Guns (Rifle)' && x.from === 14 && x.to === 15));
  assert.match(c().gcs.vitalsNote, /companion value is kept/);
  assert.throws(() => engine.dispatch('char.manualBuild', { id: pc, build: { st: 18 } }, gm), /managed by GCS/);
  const p2 = engine.dispatch('player.save', { name: 'Other' }, gm).result.id;
  assert.throws(() => engine.dispatch('char.importGcs', { id: pc, text: doc(9, 9, 9) }, { role: 'player', playerId: p2 }), /own character/);
  assert.throws(() => engine.dispatch('char.importGcs', { id: pc, text: '{"type":"template"}' }, player), /not a character|no character data/i);
});
