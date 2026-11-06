// /api/targets — shared KPI Target (Low/High) values for the pulpmill1 dashboard.
//
// Every KPI Card's Target Low/High used to live only in that one browser's localStorage,
// so saving a target never showed up for anyone else. This stores the same values in a
// single Upstash Redis HASH ("pm1:kpi-targets", one field per target key, e.g. "yieldBdt"
// or "wsd_<metricId>_<digester>") so every viewer's GET sees the latest saved value until
// someone saves a new one. Same Upstash project/credentials as /api/presence.js.
//
// Requires the same two Vercel project environment variables as /api/presence.js:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Plain CommonJS on purpose: this project has no package.json, so a bare .js file here
// defaults to CommonJS in Vercel's Node runtime with zero config.

const TARGETS_KEY = 'pm1:kpi-targets';

function sanitizeKey(k) {
  return typeof k === 'string' ? k.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) : '';
}

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
      const flat = (Array.isArray(data) && data[0] && data[0].result) || [];
      const targets = {};
      for (let i = 0; i < flat.length; i += 2) {
        try {
          targets[flat[i]] = JSON.parse(flat[i + 1]);
        } catch (e) {
          // skip a corrupted field rather than failing the whole response
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
    const key = sanitizeKey(body.key);
    if (!key) {
      res.status(400).json({ ok: false, error: 'missing_key' });
      return;
    }
    const lo = typeof body.lo === 'number' && Number.isFinite(body.lo) ? body.lo : null;
    const hi = typeof body.hi === 'number' && Number.isFinite(body.hi) ? body.hi : null;
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

  res.status(405).json({ error: 'method_not_allowed' });
};
