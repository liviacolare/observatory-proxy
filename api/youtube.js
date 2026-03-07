// api/youtube.js — YouTube Trending proxy for The Observatory
// Fetches mostPopular videos server-side, hiding the API key from the browser

const https = require('https');

const YT_API_KEY = process.env.YOUTUBE_API_KEY;

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Observatory/1.0)' },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
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
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const regionCode = req.query.region || 'US';
  const maxResults = Math.min(parseInt(req.query.max || '25'), 50);

  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&chart=mostPopular&regionCode=${regionCode}&maxResults=${maxResults}&key=${YT_API_KEY}`;
    const data = await fetchJSON(url);

    if (data.error) {
      return res.status(200).json({ ok: false, error: data.error.message, items: [] });
    }

    const items = (data.items || []).map(v => ({
      id:          v.id,
      title:       v.snippet?.title || '',
      channel:     v.snippet?.channelTitle || '',
      description: (v.snippet?.description || '').slice(0, 200),
      publishedAt: v.snippet?.publishedAt || '',
      url:         `https://youtube.com/watch?v=${v.id}`,
    }));

    res.status(200).json({ ok: true, items, region: regionCode, fetchedAt: new Date().toISOString() });
  } catch(e) {
    res.status(200).json({ ok: false, error: e.message, items: [] });
  }
};
