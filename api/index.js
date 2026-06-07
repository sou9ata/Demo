// =========================================================
//  MONEY PRINTING ENGINE V3.1 - Node.js/Vercel Version
//  Converted from PHP for Vercel deployment
// =========================================================

const https = require('https');

const TMDB_API_KEY = 'f4489c5e1329446642a6448e312c48db';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// In-memory cache (resets on cold start, good enough for Vercel)
const cache = {};

function getCached(key, duration = 3600) {
    if (cache[key] && (Date.now() - cache[key].time) < duration * 1000) {
        return cache[key].data;
    }
    return null;
}

function saveCached(key, data) {
    cache[key] = { data, time: Date.now() };
}

function fetchAPI(endpoint, params) {
    return new Promise((resolve, reject) => {
        const query = new URLSearchParams({ api_key: TMDB_API_KEY, ...params }).toString();
        const url = `${TMDB_BASE_URL}${endpoint}?${query}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(null); }
            });
        }).on('error', reject);
    });
}

function fetchURL(url) {
    return new Promise((resolve) => {
        const mod = url.startsWith('https') ? https : require('http');
        const options = {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        };
        const req = mod.get(url, options, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve({ finalUrl: res.headers.location });
                return;
            }
            resolve({ finalUrl: url });
        });
        req.setTimeout(3000, () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
    });
}

async function resolveSuperEmbed(imdb, tmdb, s, e, type) {
    if (!imdb && !tmdb) return null;
    const qs = new URLSearchParams({
        video_id: imdb || '',
        tmdb: tmdb,
        player_sources_toggle_type: 2
    });
    if (type === 'tv') { qs.set('s', s); qs.set('e', e); }
    const target = `https://getsuperembed.link/?${qs.toString()}`;
    try {
        const result = await fetchURL(target);
        if (result && result.finalUrl && result.finalUrl !== target) {
            return result.finalUrl;
        }
    } catch { }
    return null;
}

module.exports = async (req, res) => {
    // CORS - Allow all origins
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const { action, id, page = 1, query, type = 'movie', s = 1, e = 1, sort, genre, year } = req.query;

    try {
        switch (action) {

            case 'discover': {
                const cacheKey = `disc_${type}_${page}_${sort}_${genre}_${year}`;
                const cached = getCached(cacheKey, 3600);
                if (cached) { res.json(cached); return; }
                const params = {
                    page, language: 'en-US',
                    sort_by: sort || 'popularity.desc',
                    include_adult: false,
                    with_genres: genre || ''
                };
                if (year) {
                    if (type === 'tv') params.first_air_date_year = year;
                    else params.primary_release_year = year;
                }
                const endpoint = type === 'tv' ? '/discover/tv' : '/discover/movie';
                const data = await fetchAPI(endpoint, params);
                if (data) saveCached(cacheKey, data);
                res.json(data);
                break;
            }

            case 'search': {
                const data = await fetchAPI('/search/multi', { query, include_adult: false });
                if (data && data.results) {
                    data.results = data.results.filter(i => i.media_type === 'movie' || i.media_type === 'tv');
                }
                res.json(data);
                break;
            }

            case 'details': {
                const cacheKey = `det_${type}_${id}`;
                const cached = getCached(cacheKey, 86400);
                if (cached) { res.json(cached); return; }
                const endpoint = type === 'tv' ? `/tv/${id}` : `/movie/${id}`;
                const data = await fetchAPI(endpoint, { append_to_response: 'videos,credits,similar,recommendations' });
                if (data) saveCached(cacheKey, data);
                res.json(data);
                break;
            }

            case 'season_details': {
                const cacheKey = `sea_${id}_${s}`;
                const cached = getCached(cacheKey, 86400);
                if (cached) { res.json(cached); return; }
                const data = await fetchAPI(`/tv/${id}/season/${s}`, {});
                if (data) saveCached(cacheKey, data);
                res.json(data);
                break;
            }

            case 'stream_sources': {
                const externalIds = await fetchAPI(`/${type}/${id}/external_ids`, {});
                const imdbId = externalIds?.imdb_id || null;
                const servers = [];

                // Server 1: VidSrc
                const url1 = `https://vidsrc.xyz/embed/${type === 'tv' ? `tv/${id}/${s}/${e}` : `movie/${id}`}`;
                servers.push({ label: 'Server 1 (Fast HD)', icon: '🚀', data: Buffer.from(url1).toString('base64') });

                // Server 2: SuperEmbed
                const finalSuperEmbed = await resolveSuperEmbed(imdbId, id, s, e, type);
                if (finalSuperEmbed) {
                    servers.push({ label: 'Server 2 (Multi-Lang)', icon: '🌍', data: Buffer.from(finalSuperEmbed).toString('base64') });
                } else {
                    const fallback = `https://vidsrc.to/embed/${type === 'tv' ? `tv/${id}/${s}/${e}` : `movie/${id}`}`;
                    servers.push({ label: 'Server 2 (Backup)', icon: '⚡', data: Buffer.from(fallback).toString('base64') });
                }

                // Server 3: 2Embed
                if (imdbId) {
                    let url3 = `https://www.2embed.cc/embed/${imdbId}`;
                    if (type === 'tv') url3 += `&s=${s}&e=${e}`;
                    servers.push({ label: 'Server 3 (Stable)', icon: '🛡️', data: Buffer.from(url3).toString('base64') });
                }

                // Server 4: GoDrive
                let url4 = '';
                if (type === 'movie' && imdbId) url4 = `https://godriveplayer.com/player.php?imdb=${imdbId}`;
                else if (type === 'tv') url4 = `https://godriveplayer.com/player.php?type=series&tmdb=${id}&season=${s}&episode=${e}`;
                if (url4) servers.push({ label: 'Server 4 (Premium)', icon: '💎', data: Buffer.from(url4).toString('base64') });

                res.json({ status: 'success', type, imdb_id: imdbId, servers });
                break;
            }

            default:
                res.json({ status: 'error', message: 'Invalid action' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
};
      
