// api/finance.js — Yahoo Finance proxy for The Observatory
// Fetches VIX, Gold, BTC, S&P500 server-side, bypassing browser CORS
// Deploy alongside trends.js, arxiv.js, rss.js on Vercel

const https = require('https');

const SYMBOLS = [
  { id: 'vix',  symbol: '^VIX'   },
  { id: 'gold', symbol: 'GC=F'   },
  { id: 'btc',  symbol: 'BTC-USD' },
  { id: 'sp',   symbol: '^GSPC'  },
];

function fetchQuote(symbol, range) {
  range = range || '5d';
  const interval = range === '5d' ? '1d' : range === '1mo' ? '1d' : '1wk';
  return new Promise((resolve) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Observatory/1.0)',
        'Accept': 'application/json',
      },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const meta   = parsed?.chart?.result?.[0]?.meta;
          const closes = parsed?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
          const valid  = closes.filter(v => v != null);
          const current = meta?.regularMarketPrice || valid[valid.length - 1];
          const prev    = valid[valid.length - 2];
          const change  = current && prev ? ((current - prev) / prev * 100) : null;
          // Build time series
          const timestamps = parsed?.chart?.result?.[0]?.timestamp || [];
          const series = timestamps.map((ts, i) => ({
            date: new Date(ts*1000).toISOString().slice(5,10),
            value: closes[i] ?? null,
          })).filter(p => p.value != null);
          resolve({ ok: true, symbol, current, prev, change, series });
        } catch(e) {
          resolve({ ok: false, symbol, error: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, symbol, error: e.message }));
    req.on('timeout', ()  => { req.destroy(); resolve({ ok: false, symbol, error: 'timeout' }); });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const range = req.query.range || '5d';

  // ?symbols=CL%3DF — fetch custom symbols (oil, gas, etc.)
  if (req.query.symbols) {
    const customSymbols = req.query.symbols.split(',').slice(0, 4);
    const results = await Promise.all(customSymbols.map(s => fetchQuote(s.trim(), range)));
    const out = {};
    customSymbols.forEach((s, i) => { out[s.trim().replace(/[^a-zA-Z0-9]/g, '_')] = results[i]; });
    return res.status(200).json({ ok: results.some(r => r.ok), quotes: out, fetchedAt: new Date().toISOString() });
  }

  const results = await Promise.all(SYMBOLS.map(s => fetchQuote(s.symbol, range)));

  const out = {};
  SYMBOLS.forEach((s, i) => { out[s.id] = results[i]; });

  const liveCount = results.filter(r => r.ok).length;

  res.status(200).json({
    ok:         liveCount > 0,
    liveCount,
    fetchedAt:  new Date().toISOString(),
    quotes:     out,
  });
};
