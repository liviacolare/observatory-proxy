const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const query = req.query.q || 'cat:cs.AI';
  const max = req.query.max || '5';
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&start=0&max_results=${max}&sortBy=submittedDate&sortOrder=descending`;

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(url, (r) => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => resolve(body));
        r.on('error', reject);
      }).on('error', reject);
    });
    res.setHeader('Content-Type', 'application/xml');
    res.status(200).send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
