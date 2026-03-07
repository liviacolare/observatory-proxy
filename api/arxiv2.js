// api/arxiv.js — arXiv proxy for The Observatory
// Bypasses CORS and disables Vercel edge caching so each request is fresh

const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Forward all query params to arXiv, stripping internal ones
  const allowed = ['search_query', 'start', 'max_results', 'sortBy', 'sortOrder', 'id_list'];
  const params = new URLSearchParams();
  allowed.forEach(k => {
    if (req.query[k] !== undefined) params.set(k, req.query[k]);
  });

  const arxivUrl = `https://export.arxiv.org/api/query?${params.toString()}`;

  try {
    const xml = await new Promise((resolve, reject) => {
      const request = https.get(arxivUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Observatory/1.0)',
          'Accept': 'application/xml, text/xml',
        },
        timeout: 12000,
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve(data));
      });
      request.on('error', reject);
      request.on('timeout', () => { request.destroy(); reject(new Error('timeout')); });
    });

    res.setHeader('Content-Type', 'application/xml');
    res.status(200).send(xml);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
