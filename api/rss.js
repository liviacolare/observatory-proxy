// api/rss.js — RSS proxy for The Observatory
// Fetches multiple RSS feeds server-side, bypassing browser CORS restrictions
// Deploy alongside trends.js and arxiv.js on Vercel

const https = require('https');
const http  = require('http');

const DEFAULT_FEEDS = [
  { name: 'BBC',        url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'Reuters',    url: 'https://feeds.reuters.com/reuters/topNews' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { name: 'NYT',        url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
];

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Observatory/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      timeout: 8000,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseItems(xml) {
  const items = [];
  // Match <item>...</item> blocks
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const title   = block.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1]
                 || block.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || '';
    const desc    = block.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>/i)?.[1]
                 || block.match(/<description[^>]*>(.*?)<\/description>/i)?.[1] || '';
    const pubDate = block.match(/<pubDate[^>]*>(.*?)<\/pubDate>/i)?.[1] || '';
    const link    = block.match(/<link[^>]*>(.*?)<\/link>/i)?.[1]
                 || block.match(/<link>(.*?)<\/link>/i)?.[1] || '';
    if (title.trim()) {
      items.push({
        title:   title.replace(/<[^>]+>/g,'').trim(),
        desc:    desc.replace(/<[^>]+>/g,'').trim().slice(0, 200),
        pubDate: pubDate.trim(),
        link:    link.trim(),
      });
    }
  }
  return items;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const results = await Promise.all(
    DEFAULT_FEEDS.map(async (feed) => {
      try {
        const xml   = await fetchURL(feed.url);
        const items = parseItems(xml);
        return { name: feed.name, ok: true, count: items.length, items };
      } catch (e) {
        return { name: feed.name, ok: false, count: 0, items: [], error: e.message };
      }
    })
  );

  const totalItems = results.reduce((s, r) => s + r.count, 0);
  const liveFeeds  = results.filter(r => r.ok).length;

  res.status(200).json({
    ok:         liveFeeds > 0,
    liveFeeds,
    totalFeeds: DEFAULT_FEEDS.length,
    totalItems,
    fetchedAt:  new Date().toISOString(),
    feeds:      results,
  });
};
