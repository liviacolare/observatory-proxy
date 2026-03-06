const googleTrends = require('google-trends-api');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const keywords = req.query.keywords?.split(',') || ['meaning of life'];

  try {
    const results = await Promise.all(
      keywords.map(kw =>
        googleTrends.interestOverTime({
          keyword: kw,
          startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
        }).then(JSON.parse)
      )
    );
    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
