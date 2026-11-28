// /api/data-analysis — shared/pinned "snapshot column" configs for the Data for analysis page.
//
// Every add/delete/edit/pin on the Data for analysis page's snapshot columns posts the FULL current
// column list here (not only the ones a viewer has explicitly pinned) — the whole list is one
// coherent ordered array, so (like /api/layout.js) it's stored as a single JSON blob under one Redis
// key ("pm1:data-analysis-cols") rather than a hash-per-field like /api/targets.js. Each column
// object carries its own "saved" flag (true once pinned) purely so every viewer redraws the same
// "ยังไม่บันทึก" badge — it does not gate whether a column is stored here. GET returns the parsed array
// (or [] if the list has never been touched, or everything in it has since been deleted, in which
// case the client falls back to the sheet template's own 3 unconfigured snapshot-column slots); POST
// overwrites the whole stored array. Same Upstash project/credentials as /api/presence.js,
// /api/targets.js and /api/layout.js.
//
// Requires the same two Vercel project environment variables as the other three:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// Plain CommonJS on purpose: this project has no package.json, so a bare .js file here
// defaults to CommonJS in Vercel's Node runtime with zero config.

const COLUMNS_KEY = 'pm1:data-analysis-cols';
// Edited Unit / KPI cells: one Redis hash, field "<group>|<subgroup>|<label>::unit" (or "::spec"),
// value = the text last saved for that cell. Per-cell HSET means two people editing different
// cells never overwrite each other; for the same cell the latest save wins.
const META_KEY = 'pm1:data-analysis-meta';
const MAX_META_FIELD = 300, MAX_META_VALUE = 200;
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
        body: JSON.stringify([['GET', COLUMNS_KEY], ['HGETALL', META_KEY]]),
      });
      if (!r.ok) {
        res.status(200).json({ columns: [], meta: {}, error: 'upstash_error' });
        return;
      }
      const data = await r.json();
      const colRes = Array.isArray(data) ? data[0] : null;
      const metaRes = Array.isArray(data) ? data[1] : null;
      let columns = [];
      if (colRes && typeof colRes.result === 'string') {
        try {
          const parsed = JSON.parse(colRes.result);
          columns = Array.isArray(parsed) ? parsed : [];
        } catch (e) { columns = []; }
      }
      const meta = {};
      if (metaRes && Array.isArray(metaRes.result)) {
        for (let i = 0; i + 1 < metaRes.result.length; i += 2) meta[metaRes.result[i]] = metaRes.result[i + 1];
      }
      res.status(200).json({ columns, meta });
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
    // {meta: {"<field>::unit": "text", ...}} — save edited Unit / KPI cells only
    if (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
      const cmd = ['HSET', META_KEY];
      for (const k of Object.keys(body.meta)) {
        const v = body.meta[k];
        if (typeof v !== 'string' || k.length > MAX_META_FIELD || v.length > MAX_META_VALUE || !/::(unit|spec)$/.test(k)) continue;
        cmd.push(k, v);
      }
      if (cmd.length < 4) { res.status(400).json({ ok: false, error: 'bad_request' }); return; }
      try {
        const r = await fetch(url + '/pipeline', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify([cmd]),
        });
        res.status(200).json(r.ok ? { ok: true } : { ok: false, error: 'upstash_error' });
      } catch (e) {
        res.status(200).json({ ok: false, error: 'fetch_failed' });
      }
      return;
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
