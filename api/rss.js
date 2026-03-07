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

function extractText(block, tag) {
  return (
    block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i'))?.[1] ||
    block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || ''
  ).replace(/<[^>]+>/g, '').trim();
}

function parseItems(xml) {
  const items = [];

  // Detect format: Atom uses <entry>, RSS uses <item>
  const isAtom = /<entry[\s>]/i.test(xml);
  const blockTag = isAtom ? 'entry' : 'item';
  const blockRegex = new RegExp(`<${blockTag}[\\s>][\\s\\S]*?<\\/${blockTag}>`, 'gi');
  const blocks = xml.match(blockRegex) || [];

  for (const block of blocks) {
    const title = extractText(block, 'title');

    // Link: RSS uses <link>url</link>, Atom uses <link href="url"/>
    const link = isAtom
      ? (block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || extractText(block, 'link'))
      : (extractText(block, 'link') || block.match(/<link>(.*?)<\/link>/i)?.[1] || '');

    // Date: RSS uses pubDate, Atom uses published or updated
    const pubDate = extractText(block, 'pubDate') ||
                    extractText(block, 'published') ||
                    extractText(block, 'updated') || '';

    // Description: RSS uses description, Atom uses summary or content
    const desc = extractText(block, 'description') ||
                 extractText(block, 'summary') ||
                 extractText(block, 'content') || '';

    if (title) {
      items.push({
        title:   title.slice(0, 150),
        desc:    desc.slice(0, 200),
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
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // ?src=URL — fetch a single custom RSS feed (YouTube, SSRN, etc.)
  if (req.query.src) {
    try {
      const xml   = await fetchURL(req.query.src);
      const items = parseItems(xml);
      return res.status(200).json({ ok: true, items, fetchedAt: new Date().toISOString() });
    } catch (e) {
      return res.status(200).json({ ok: false, items: [], error: e.message });
    }
  }

  // Default: fetch all standard feeds
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
