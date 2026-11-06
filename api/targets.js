// /api/targets — shared KPI Target (LOW/HIGH) storage for the pulpmill1 dashboard.
//
// Backed by a single Upstash Redis hash ("pm1:kpi-targets"): each field is a
// target key (e.g. "yieldBalTank" or "wsd_moisture_1") and its value is a JSON
// string {lo, hi}. GET returns every saved target in one HGETALL call so the
// dashboard can load them all on boot; POST saves (or overwrites) exactly one
// field, so one person's save is visible to every other viewer on their next
// load/poll, and stays in effect until someone saves a new value for that key.
//
// Requires the same two Vercel project environment variables as /api/presence
// (Settings -> Environment Variables), taken from an Upstash Redis database's
// "REST API" panel:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Both stay server-side only — this function is the only thing that ever reads
// them; the browser never sees the token.
// Plain CommonJS on purpose: this project has no package.json, so a bare .js
// file here defaults to CommonJS in Vercel's Node runtime with zero config.

const TARGETS_KEY = 'pm1:kpi-targets';
const KEY_RE = /^[a-zA-Z0-9_-]{1,128}$/;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    res.status(200).json({ targets: {}, error: 'not_configured' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const r = await fetch(url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify([['HGETALL', TARGETS_KEY]]),
      });
      if (!r.ok) {
        res.status(200).json({ targets: {}, error: 'upstash_error' });
        return;
      }
      const data = await r.json();
      const last = Array.isArray(data) ? data[data.length - 1] : null;
      const flat = Array.isArray(last && last.result) ? last.result : [];
      const targets = {};
      for (let i = 0; i < flat.length - 1; i += 2) {
        try {
          targets[flat[i]] = JSON.parse(flat[i + 1]);
        } catch (e) {
          // skip a malformed stored value rather than failing the whole response
        }
      }
      res.status(200).json({ targets });
    } catch (e) {
      res.status(200).json({ targets: {}, error: 'fetch_failed' });
    }
    return;
  }

  if (req.method === 'POST') {
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch (e) {
      body = {};
    }
    const key = typeof body.key === 'string' ? body.key : '';
    const lo = body.lo === null || body.lo === undefined || body.lo === '' ? null : Number(body.lo);
    const hi = body.hi === null || body.hi === undefined || body.hi === '' ? null : Number(body.hi);
    if (!KEY_RE.test(key) || (lo != null && !Number.isFinite(lo)) || (hi != null && !Number.isFinite(hi))) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    try {
      const r = await fetch(url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify([['HSET', TARGETS_KEY, key, JSON.stringify({ lo, hi })]]),
      });
      if (!r.ok) {
        res.status(200).json({ ok: false, error: 'upstash_error' });
        return;
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(200).json({ ok: false, error: 'fetch_failed' });
    }
    return;
  }

  res.status(405).json({ ok: false, error: 'method_not_allowed' });
};
