// /api/presence — real-time concurrent-viewer count for the pulpmill1 dashboard.
//
// Backed by an Upstash Redis sorted set ("pm1:presence"): each open tab sends a
// heartbeat with its own random session id every ~15s; the score is the server's
// own timestamp for that heartbeat. On every call we first prune members whose
// score is older than PRESENCE_TTL_MS (i.e. a tab that stopped heartbeating —
// closed, network-dropped, etc.) and then return ZCARD, the count of tabs seen
// in the last window. This is a "how many right now" count, not a cumulative
// total — it can go up AND down, and never remembers a past visit.
//
// Requires two Vercel project environment variables (Settings -> Environment
// Variables), taken from an Upstash Redis database's "REST API" panel:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Both stay server-side only — this function is the only thing that ever reads
// them; the browser never sees the token.
// Plain CommonJS on purpose: this project has no package.json, so a bare .js
// file here defaults to CommonJS in Vercel's Node runtime with zero config.

const PRESENCE_TTL_MS = 30000; // a tab not heard from in 30s is considered gone
const PRESENCE_KEY = 'pm1:presence';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    res.status(200).json({ count: null, error: 'not_configured' });
    return;
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (e) {
    body = {};
  }
  const sid = typeof body.sid === 'string' ? body.sid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) : '';
  const leaving = !!body.leave;

  const now = Date.now();
  const cutoff = now - PRESENCE_TTL_MS;

  const commands = [['ZREMRANGEBYSCORE', PRESENCE_KEY, '-inf', String(cutoff)]];
  if (sid && leaving) commands.push(['ZREM', PRESENCE_KEY, sid]);
  else if (sid) commands.push(['ZADD', PRESENCE_KEY, String(now), sid]);
  commands.push(['ZCARD', PRESENCE_KEY]);

  try {
    const r = await fetch(url + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!r.ok) {
      res.status(200).json({ count: null, error: 'upstash_error' });
      return;
    }
    const data = await r.json();
    const last = Array.isArray(data) ? data[data.length - 1] : null;
    const count = last && typeof last.result === 'number' ? last.result : null;
    res.status(200).json({ count });
  } catch (e) {
    res.status(200).json({ count: null, error: 'fetch_failed' });
  }
};
