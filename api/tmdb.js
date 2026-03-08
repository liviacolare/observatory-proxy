// api/tmdb.js — TMDB proxy for The Observatory
// Calls TMDB server-side so Bearer token is never exposed to the browser
// and CORS is handled cleanly.

const https = require('https');

const BEARER = process.env.TMDB_BEARER_TOKEN ||
  'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmZmRjMDIzYzg1MzBlNzllNjY3ZmZiNjA4OTdiNTVlNyIsIm5iZiI6MTc3MjgyODc1Mi41MDgsInN1YiI6IjY5YWIzODUwYjNmOWQ5ODA5YTQ4YWRkZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.ImvP7KlKSspMeTQp-Zdct9AvtGqB699hd8XA-MlRZZo';

function fetchJSON(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { ...headers, 'User-Agent': 'Observatory/1.0' },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // endpoint param e.g. /trending/movie/week or /trending/tv/day
  const endpoint = req.query.endpoint || '/trending/movie/week';
  const language = req.query.language || 'en-US';
  const page = req.query.page || '1';

  // Whitelist — only allow trending endpoints
  if (!endpoint.startsWith('/trending/')) {
    return res.status(400).json({ ok: false, error: 'Only /trending/ endpoints allowed' });
  }

  const url = `https://api.themoviedb.org/3${endpoint}?language=${language}&page=${page}`;

  try {
    const { status, body } = await fetchJSON(url, {
      'Authorization': `Bearer ${BEARER}`,
      'Accept': 'application/json',
    });

    if (status !== 200) {
      return res.status(200).json({ ok: false, error: `TMDB ${status}`, results: [] });
    }

    res.status(200).json({ ok: true, ...body, fetchedAt: new Date().toISOString() });
  } catch(e) {
    res.status(200).json({ ok: false, error: e.message, results: [] });
  }
};
