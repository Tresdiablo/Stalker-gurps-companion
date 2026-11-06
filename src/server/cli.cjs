#!/usr/bin/env node
'use strict';
/**
 * Run the campaign host without Electron (headless GM server, development, or Linux/macOS).
 *   node src/server/cli.cjs [--data DIR] [--port 7788] [--lan]
 * Prints the GM link; open it in a browser on this computer.
 */
const path = require('node:path');
const { Host } = require('./host');
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const dataDir = path.resolve(opt('--data', path.join(process.cwd(), '.campaign-data')));
const port = Number(opt('--port', 7788));
(async () => {
  const host = new Host({ dataDir, port, bind: args.includes('--lan') ? '0.0.0.0' : '127.0.0.1', legacyDataFile: opt('--legacy', null) });
  await host.start();
  if (args.includes('--lan')) await host.setLan(true);
  console.log(`S.T.A.L.K.E.R. GURPS Companion host running.\nCampaign data: ${dataDir}\nGM link (keep private): ${host.url()}`);
  if (process.env.SGC_PRINT_TOKEN) console.log(`GM_TOKEN=${host.gmToken}`);
  const stop = async () => { await host.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})().catch(e => { console.error(e); process.exit(1); });
