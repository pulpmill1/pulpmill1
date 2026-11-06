// /api/layout — shared dashboard KPI Card / group layout (drag-and-drop order) for pulpmill1.
//
// The arrangement (which order groups appear in on each page, which order KPI cards appear in
// within a group, and which group a card has been dragged into) is one coherent structure per
// save, not independent fields, so it's stored as a single JSON blob under one Redis key
// ("pm1:kpi-layout") rather than a hash-per-field like /api/targets.js. GET returns the parsed
// JSON (or {} if nothing has ever been saved, in which case the client falls back to the
// code-defined default order exactly as before this feature existed); POST overwrites the
// whole stored blob. Same Upstash project/credentials as /api/presence.js and /api/targets.js.
//
// Requires the same two Vercel project environment variables as the other two:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Plain CommonJS on purpose: this project has no package.json, so a bare .js file here
// defaults to CommonJS in Vercel's Node runtime with zero config.

const LAYOUT_KEY = 'pm1:kpi-layout';
const MAX_BODY_CHARS = 200000; // generous ceiling against an abusive payload; real layouts are a few KB

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    res.status(200).json({ layout: {}, error: 'not_configured' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const r = await fetch(url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify([['GET', LAYOUT_KEY]]),
      });
      if (!r.ok) {
        res.status(200).json({ layout: {}, error: 'upstash_error' });
        return;
      }
      const data = await r.json();
      const last = Array.isArray(data) ? data[data.length - 1] : null;
      let layout = {};
      if (last && typeof last.result === 'string') {
        try { layout = JSON.parse(last.result); } catch (e) { layout = {}; }
      }
      res.status(200).json({ layout });
    } catch (e) {
      res.status(200).json({ layout: {}, error: 'fetch_failed' });
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
    const layout = body && typeof body.layout === 'object' && body.layout !== null ? body.layout : null;
    const serialized = layout ? JSON.stringify(layout) : null;
    if (!serialized || serialized.length > MAX_BODY_CHARS) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    try {
      const r = await fetch(url + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify([['SET', LAYOUT_KEY, serialized]]),
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
