'use strict';
/**
 * Optional Tabletop Simulator bridge using TTS's External Editor API:
 *  - TTS listens on localhost:39999; we send {messageID:3, guid:"-1", script} to execute Lua.
 *  - TTS connects to localhost:39998 and sends JSON; Lua's sendExternalMessage(table) arrives as
 *    {messageID:4, customMessage:{...}}.
 * The companion works fully without TTS; this only adds token linking, spawning and status text.
 * Note: other TTS editor plugins (e.g. the Atom/VS Code TTS extensions) also listen on 39998 —
 * close them while using the bridge.
 */
const net = require('node:net');

const SEND_PORT = 39999;
const LISTEN_PORT = 39998;

function luaString(text) {
  let eq = '=';
  while (text.includes(`]${eq}]`)) eq += '=';
  return `[${eq}[${text}]${eq}]`;
}

class TtsBridge {
  constructor({ onMessage = () => {}, onStatus = () => {}, host = '127.0.0.1', sendPort = SEND_PORT, listenPort = LISTEN_PORT } = {}) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.host = host;
    this.sendPort = sendPort;
    this.listenPort = listenPort;
    this.server = null;
    this.state = { enabled: false, listening: false, reachable: false, lastMessageAt: null, lastSentAt: null, lastError: null };
  }

  status() { return { ...this.state }; }
  setState(patch) { Object.assign(this.state, patch); this.onStatus(this.status()); }

  start() {
    if (this.server) return Promise.resolve(this.status());
    this.setState({ enabled: true });
    return new Promise(resolve => {
      this.server = net.createServer(sock => {
        let buf = '';
        sock.setEncoding('utf8');
        sock.on('data', d => { buf += d; if (buf.length > 4 * 1024 * 1024) sock.destroy(); });
        sock.on('end', () => this.receive(buf));
        sock.on('error', () => {});
      });
      this.server.on('error', e => { this.setState({ listening: false, lastError: `Cannot listen on ${this.listenPort}: ${e.code || e.message}` }); this.server = null; resolve(this.status()); });
      this.server.listen(this.listenPort, this.host, () => { this.setState({ listening: true, lastError: null }); this.ping().then(() => resolve(this.status())); });
    });
  }

  stop() { if (this.server) { this.server.close(); this.server = null; } this.setState({ enabled: false, listening: false }); }

  receive(text) {
    // TTS may send several JSON objects back-to-back
    for (const chunk of String(text).split(/(?<=\})\s*(?=\{)/)) {
      let msg; try { msg = JSON.parse(chunk); } catch { continue; }
      this.setState({ lastMessageAt: new Date().toISOString(), reachable: true });
      if (msg.messageID === 4 && msg.customMessage) this.onMessage(msg.customMessage);
      else if (msg.messageID === 3 || msg.messageID === 2) this.onMessage({ type: 'log', text: msg.message || msg.error || '' });
    }
  }

  /** Execute Lua in TTS Global. Resolves true when delivered. */
  execute(script) {
    return new Promise(resolve => {
      const sock = net.connect({ host: this.host, port: this.sendPort });
      const done = ok => { sock.destroy(); resolve(ok); };
      sock.setTimeout(1500, () => { this.setState({ reachable: false, lastError: 'Tabletop Simulator did not respond.' }); done(false); });
      sock.on('error', e => { this.setState({ reachable: false, lastError: e.code === 'ECONNREFUSED' ? 'Tabletop Simulator is not running (or no game is loaded).' : e.message }); done(false); });
      sock.on('connect', () => { sock.end(JSON.stringify({ messageID: 3, guid: '-1', script }), () => { this.setState({ reachable: true, lastSentAt: new Date().toISOString(), lastError: null }); done(true); }); });
    });
  }

  ping() { return this.execute('if stalkerCompanion and stalkerCompanion.ping then stalkerCompanion.ping() end'); }

  /** Call a function of the companion Global.lua with a JSON payload. */
  call(fn, payload) {
    if (!/^[a-zA-Z]+$/.test(fn)) throw new Error('Invalid TTS function.');
    return this.execute(`if stalkerCompanion and stalkerCompanion.${fn} then stalkerCompanion.${fn}(JSON.decode(${luaString(JSON.stringify(payload))})) else print("Companion script missing: load tts/Global.lua into Global") end`);
  }
}

module.exports = { TtsBridge, luaString, SEND_PORT, LISTEN_PORT };
