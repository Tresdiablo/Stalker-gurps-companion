// Connection to the campaign host. Actions carry a requestId so a retry after a dropped
// connection is applied at most once by the server.
const listeners = new Set();
let ws = null, reqSeq = 0, retryDelay = 500;
const pending = new Map(); // reqId -> { resolve, reject, msg }
export const conn = { status: 'connecting', view: null, role: null, error: null };

function emit() { for (const f of listeners) f(); }
export function subscribe(f) { listeners.add(f); return () => listeners.delete(f); }

function connect() {
  conn.status = 'connecting'; emit();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    conn.status = 'online'; retryDelay = 500; emit();
    for (const p of pending.values()) ws.send(JSON.stringify(p.msg)); // resend unacknowledged (idempotent)
  };
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === 'hello') { conn.role = m.role; conn.playerId = m.playerId; }
    else if (m.type === 'full') { conn.full = m.max; }
    else if (m.type === 'view') { conn.view = m.view; emit(); }
    else if (m.type === 'result') {
      const p = pending.get(m.reqId);
      if (!p) return;
      pending.delete(m.reqId);
      if (m.ok) p.resolve(m); else { const e = new Error(m.error || 'Failed'); e.code = m.code; p.reject(e); }
    }
  };
  ws.onclose = ev => {
    if (ev.code === 4001) { conn.status = 'full'; conn.full = conn.full || 8; emit(); setTimeout(connect, 10000); return; }
    conn.status = ev.code === 1006 && !conn.view ? 'unauthorized' : 'offline'; emit();
    setTimeout(connect, retryDelay); retryDelay = Math.min(8000, retryDelay * 2);
  };
}

function send(msg) {
  return new Promise((resolve, reject) => {
    const reqId = ++reqSeq;
    msg.reqId = reqId;
    pending.set(reqId, { resolve, reject, msg });
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
    setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); reject(new Error('The host did not answer. Check the connection.')); } }, 20000);
  });
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());

/** Run an engine action. */
export function act(action, payload = {}) { return send({ type: 'action', action, payload, requestId: uuid() }); }
/** Run a host command (GM). */
export function host(command, payload = {}) { return send({ type: 'host', command, payload }); }

export async function whoami() { const r = await fetch('/api/whoami'); return r.json(); }
export async function login(playerId, code) {
  const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ playerId, code }) });
  if (!r.ok) throw new Error((await r.json()).error || 'Login failed');
}
export function start() { connect(); }
