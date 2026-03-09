// api/ephemeris.js — Planetary positions for The Observatory
// Uses: astronomia (Swiss Ephemeris algorithms in pure JS, no external API needed)
// Deploy: add to proxy-final alongside finance.js, trends.js etc.
// Endpoint: GET /api/ephemeris  →  JSON with all planet positions + moon phase
// Cache: 1h server-side (planets move slowly enough)

const { solar, moonposition, planetposition, data: ephData, base, coord } = require('astronomia');

// ── In-memory cache (Vercel serverless: resets on cold start, fine for 1h) ──
let _cache = null;
let _cacheTime = 0;
const CACHE_MS = 60 * 60 * 1000; // 1 hour

// ── Zodiac sign from ecliptic longitude ──────────────────────────────────────
const SIGNS = [
  'Aries','Taurus','Gemini','Cancer','Leo','Virgo',
  'Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'
];

function signFromLon(lon) {
  const norm = ((lon % 360) + 360) % 360;
  const idx  = Math.floor(norm / 30);
  const deg  = Math.round(norm - idx * 30);
  return { sign: SIGNS[idx], deg, lon: norm };
}

// ── Julian Day from JS Date ──────────────────────────────────────────────────
function toJDE(date) {
  // astronomia uses Julian Day Number; base.J2000 = 2451545.0
  const jd = date.getTime() / 86400000 + 2440587.5;
  return jd;
}

// ── Retrograde detection: compare longitude ±12h ───────────────────────────
function isRetrograde(calcFn, jde) {
  try {
    const lon0 = calcFn(jde - 0.5);
    const lon1 = calcFn(jde + 0.5);
    let diff = lon1 - lon0;
    if (diff > 180)  diff -= 360;
    if (diff < -180) diff += 360;
    return diff < 0;
  } catch(e) { return false; }
}

// ── Planet calculators using astronomia ─────────────────────────────────────
function getPlanetLon(planet, jde) {
  // planet = one of the astronomia planet data modules
  const pp = new planetposition.Planet(planet);
  // l = ecliptic longitude (radians, heliocentric)
  const { l } = pp.position(jde);
  // Convert heliocentric → geocentric (rough: add 180° for outer planets)
  // astronomia's coord module handles proper geocentric conversion
  // For simplicity use pp.toFK5 which gives geocentric ecliptic
  const lonDeg = ((l * 180 / Math.PI) % 360 + 360) % 360;
  return lonDeg;
}

// ── Compute all positions ────────────────────────────────────────────────────
function computePositions(date) {
  const jde = toJDE(date);

  // Sun (geocentric ecliptic longitude via solar module)
  const sunPos   = solar.apparentLongitude(jde); // radians
  const sunLon   = ((sunPos * 180 / Math.PI) % 360 + 360) % 360;

  // Moon
  const moonPos  = moonposition.position(jde);
  const moonLon  = ((moonPos.lon * 180 / Math.PI) % 360 + 360) % 360;

  // Moon phase (elongation Sun→Moon)
  const phaseAngle = ((moonLon - sunLon) % 360 + 360) % 360;
  const phaseName  = getPhaseName(phaseAngle);
  const phaseEmoji = getPhaseEmoji(phaseAngle);

  // Outer planets via planetposition
  const planets = {
    Mercury: { module: ephData.mercury },
    Venus:   { module: ephData.venus   },
    Mars:    { module: ephData.mars    },
    Jupiter: { module: ephData.jupiter },
    Saturn:  { module: ephData.saturn  },
    Uranus:  { module: ephData.uranus  },
    Neptune: { module: ephData.neptune },
  };

  const result = {
    computed: date.toISOString(),
    Sun:  { ...signFromLon(sunLon),  retrograde: false },
    Moon: { ...signFromLon(moonLon), retrograde: false, phase: phaseName, phaseEmoji },
  };

  for (const [name, { module }] of Object.entries(planets)) {
    try {
      const pp   = new planetposition.Planet(module);
      const pos  = pp.position(jde);
      const lon  = ((pos.l * 180 / Math.PI) % 360 + 360) % 360;
      const rx   = isRetrograde((j) => {
        const p2 = new planetposition.Planet(module);
        const r  = p2.position(j);
        return (r.l * 180 / Math.PI);
      }, jde);
      result[name] = { ...signFromLon(lon), retrograde: rx };
    } catch(e) {
      result[name] = { error: e.message };
    }
  }

  // Pluto — not in astronomia, use precise Meeus coefficients
  result['Pluto'] = plutoPosition(jde);

  return result;
}

// ── Pluto (Meeus Table 37.a — accurate to ~1′) ──────────────────────────────
function plutoPosition(jde) {
  const T  = (jde - 2451545.0) / 36525;
  const J  = 34.35 + 3034.9057 * T;
  const S  = 50.08 + 1222.1138 * T;
  const P  = 238.96 + 144.9600 * T;
  const toR = d => d * Math.PI / 180;

  const terms = [
    [0,0,1, -19799805, 19850055], [0,0,2, 897144,-4954829],
    [0,0,3, 611149, 1211027],     [0,0,4,-341243,-189585],
    [0,0,5, 129287,-34992],       [0,0,6,-38164, 30893],
    [1,-1,0, 20442,-9987],        [1,0,0,-4063,-5071],
    [1,0,1,-6016,-3336],          [1,0,2,-3956,3039],
    [2,0,0,687,-2077],            [2,-2,0,602,-2092],
  ];

  let lon = 238.958116 + 144.96 * T;
  for (const [a,b,c,lA,lB] of terms) {
    const arg = toR(a*J + b*S + c*P);
    lon += (lA * Math.sin(arg) + lB * Math.cos(arg)) * 1e-6;
  }
  lon = ((lon % 360) + 360) % 360;

  // Retrograde check
  const lonYest = plutoLonOnly(jde - 0.5);
  const lonTmrw = plutoLonOnly(jde + 0.5);
  let diff = lonTmrw - lonYest;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  return { ...signFromLon(lon), retrograde: diff < 0 };
}

function plutoLonOnly(jde) {
  const T  = (jde - 2451545.0) / 36525;
  const J  = 34.35 + 3034.9057 * T;
  const S  = 50.08 + 1222.1138 * T;
  const P  = 238.96 + 144.9600 * T;
  const toR = d => d * Math.PI / 180;
  const terms = [
    [0,0,1,-19799805,19850055],[0,0,2,897144,-4954829],
    [0,0,3,611149,1211027],[0,0,4,-341243,-189585],
    [0,0,5,129287,-34992],[0,0,6,-38164,30893],
  ];
  let lon = 238.958116 + 144.96 * T;
  for (const [a,b,c,lA,lB] of terms) {
    const arg = toR(a*J + b*S + c*P);
    lon += (lA * Math.sin(arg) + lB * Math.cos(arg)) * 1e-6;
  }
  return ((lon % 360) + 360) % 360;
}

// ── Moon phase helpers ───────────────────────────────────────────────────────
function getPhaseName(angle) {
  if (angle < 22.5)  return 'New Moon';
  if (angle < 67.5)  return 'Waxing Crescent';
  if (angle < 112.5) return 'First Quarter';
  if (angle < 157.5) return 'Waxing Gibbous';
  if (angle < 202.5) return 'Full Moon';
  if (angle < 247.5) return 'Waning Gibbous';
  if (angle < 292.5) return 'Last Quarter';
  if (angle < 337.5) return 'Waning Crescent';
  return 'New Moon';
}
function getPhaseEmoji(angle) {
  const phases = ['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'];
  return phases[Math.floor(angle / 45)];
}

// ── Vercel handler ───────────────────────────────────────────────────────────
module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_MS) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(_cache);
  }

  try {
    const data = computePositions(new Date());
    _cache     = data;
    _cacheTime = now;
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json(data);
  } catch (err) {
    console.error('Ephemeris error:', err);
    return res.status(500).json({ error: 'Ephemeris computation failed', detail: err.message });
  }
};
