// /api/data-analysis — shared/pinned "snapshot column" configs for the Data for analysis page.
//
// Each snapshot column (date-range granularity + value, plus an optional Adt/day production-range
// filter) that a viewer pins stays visible to everyone who opens the Dashboard until someone
// deletes it or pins a change — the whole list is one coherent ordered array, so (like
// /api/layout.js) it's stored as a single JSON blob under one Redis key ("pm1:data-analysis-cols")
// rather than a hash-per-field like /api/targets.js. GET returns the parsed array (or [] if nothing
// has ever been saved, in which case the client falls back to the sheet template's own 3
// unconfigured/local-only snapshot-column slots); POST overwrites the whole stored array. Same
// Upstash project/credentials as /api/presence.js, /api/targets.js and /api/layout.js.
//
// Requires the same two Vercel project environment variables as the other three:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Plain CommonJS on purpose: this project has no package.json, so a bare .js file here
// defaults to CommonJS in Vercel's Node runtime with zero config.

const COLUMNS_KEY = 'pm1:data-analysis-cols';
const MAX_BODY_CHARS = 200000; // generous ceiling against an abusive payload; real column lists are a few KB

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    res.status(200).json({ columns: [], error: 'not_configured' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const r = await fetch(url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify([['GET', COLUMNS_KEY]]),
      });
      if (!r.ok) {
        res.status(200).json({ columns: [], error: 'upstash_error' });
        return;
      }
      const data = await r.json();
      const last = Array.isArray(data) ? data[data.length - 1] : null;
      let columns = [];
      if (last && typeof last.result === 'string') {
        try {
          const parsed = JSON.parse(last.result);
          columns = Array.isArray(parsed) ? parsed : [];
        } catch (e) { columns = []; }
      }
      res.status(200).json({ columns });
    } catch (e) {
      res.status(200).json({ columns: [], error: 'fetch_failed' });
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
    const columns = Array.isArray(body.columns) ? body.columns : null;
    const serialized = columns ? JSON.stringify(columns) : null;
    if (!serialized || serialized.length > MAX_BODY_CHARS) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    try {
      const r = await fetch(url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify([['SET', COLUMNS_KEY, serialized]]),
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
