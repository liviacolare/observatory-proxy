// api/trends.js — Google Trends proxy for The Observatory
// In-memory cache: serves last valid fetch when Google blocks.
// Cache TTL: 6 hours. Badge returned so the UI can show "cached · Xh ago".

const googleTrends = require('google-trends-api');

// ── In-memory cache (per Vercel instance, resets on cold start) ──────
// Key: `${keywords}|${geo}|${timeframe}`
const CACHE = {};
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function cacheKey(keywords, geo, timeframe) {
  return `${keywords.join(',')}|${geo}|${timeframe}`;
}

function getStartTime(tf) {
  const now = new Date();
  if (tf === 'today 3-m')  return new Date(now - 90  * 864e5);
  if (tf === 'today 5-y')  return new Date(now - 1825 * 864e5);
  if (tf === 'today 1-m')  return new Date(now - 30  * 864e5);
  return new Date(now - 365 * 864e5); // default 12 months
}

async function tryFetch(keyword, startTime, geo) {
  const opts = { keyword, startTime };
  if (geo) opts.geo = geo;
  const raw = await googleTrends.interestOverTime(opts);
  return JSON.parse(raw);
}

async function fetchLive(keywords, geo, timeframe) {
  const startTime = getStartTime(timeframe);
  const results = [];
  const errors  = [];

  for (const kw of keywords) {
    let success = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
        const data = await tryFetch(kw, startTime, geo);
        const timeline = data?.default?.timelineData || [];
        results.push({ keyword: kw, timeline });
        success = true;
        break;
      } catch(e) {
        errors.push(`${kw}[${attempt}]: ${e.message?.slice(0, 60)}`);
      }
    }
    if (!success) results.push({ keyword: kw, timeline: [] });
    // Polite delay between keywords
    await new Promise(r => setTimeout(r, 400));
  }

  const liveCount = results.filter(r => r.timeline.length > 0).length;
  return { results, errors, liveCount };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const keywordsRaw = req.query.keywords || req.query.keyword || 'meaning,anxiety,future,identity,belonging';
  const keywords    = keywordsRaw.split(',').map(k => k.trim()).filter(Boolean).slice(0, 5);
  const geo         = req.query.geo || '';
  const timeframe   = req.query.timeframe || 'today 12-m';
  const key         = cacheKey(keywords, geo, timeframe);
  const now         = Date.now();

  // ── Try live fetch ───────────────────────────────────────
  try {
    const { results, errors, liveCount } = await fetchLive(keywords, geo, timeframe);

    if (liveCount > 0) {
      // Save to cache
      CACHE[key] = { results, fetchedAt: new Date().toISOString(), ts: now };
      return res.status(200).json({
        ok: true,
        cached: false,
        results,
        fetchedAt: CACHE[key].fetchedAt,
      });
    }

    // Live failed — try cache
    const cached = CACHE[key];
    if (cached) {
      const ageMs  = now - cached.ts;
      const ageHrs = (ageMs / 36e5).toFixed(1);
      const stale  = ageMs > CACHE_TTL_MS;
      return res.status(200).json({
        ok: true,
        cached: true,
        stale,
        cacheAgeHours: parseFloat(ageHrs),
        fetchedAt: cached.fetchedAt,
        results: cached.results,
        liveError: errors.slice(0, 2).join('; '),
      });
    }

    // No cache either
    return res.status(200).json({
      ok: false,
      cached: false,
      error: 'Google Trends blocked — no cache available yet. Try again in a few minutes.',
      results: keywords.map(k => ({ keyword: k, timeline: [] })),
    });

  } catch(e) {
    // Unexpected error — still try cache
    const cached = CACHE[key];
    if (cached) {
      const ageHrs = ((now - cached.ts) / 36e5).toFixed(1);
      return res.status(200).json({
        ok: true,
        cached: true,
        cacheAgeHours: parseFloat(ageHrs),
        fetchedAt: cached.fetchedAt,
        results: cached.results,
        liveError: e.message?.slice(0, 80),
      });
    }
    return res.status(200).json({
      ok: false,
      error: e.message,
      results: keywords.map(k => ({ keyword: k, timeline: [] })),
    });
  }
};
