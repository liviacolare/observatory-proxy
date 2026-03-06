const googleTrends = require('google-trends-api');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const keywords = req.query.keywords?.split(',') || ['meaning of life'];
  const geo = req.query.geo || '';
  const timeframe = req.query.timeframe || 'today 12-m';

  // Calculate startTime from timeframe string
  function getStartTime(tf) {
    const now = new Date();
    if (tf === 'today 3-m') return new Date(now - 90 * 24 * 60 * 60 * 1000);
    if (tf === 'today 5-y') return new Date(now - 5 * 365 * 24 * 60 * 60 * 1000);
    return new Date(now - 365 * 24 * 60 * 60 * 1000); // default 12 months
  }

  try {
    const options = keywords.map(kw => ({
      keyword: kw,
      startTime: getStartTime(timeframe),
      ...(geo ? { geo } : {}),
    }));

    const results = await Promise.all(
      options.map(opt => googleTrends.interestOverTime(opt).then(JSON.parse))
    );

    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
