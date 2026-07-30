/**
 * Shared Helper Functions
 * Common utilities used across the application
 */

const { spawn } = require('child_process');
const fsPromises = require('fs').promises;
const httpClient = require('./http-client');
const security = require('./security');

// Baileys is ESM-only since v7 — lazy-load via dynamic import
let _downloadContentFromMessage = null;

async function _loadBaileysHelper() {
    if (!_downloadContentFromMessage) {
        const baileys = await import('@whiskeysockets/baileys');
        _downloadContentFromMessage = baileys.downloadContentFromMessage;
    }
    return _downloadContentFromMessage;
}

// --- HELPER FUNCTIONS ---

/**
 * Spawn Promise (Safe async process execution)
 */
function spawnPromise(command, args) {
    return new Promise((resolve, reject) => {
        // Validate command to prevent injection
        const allowedCommands = ['yt-dlp', 'ffmpeg', 'ping', 'node', 'python3'];
        if (!allowedCommands.includes(command)) {
            return reject(new Error('Command not allowed'));
        }

        const proc = spawn(command, args);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (data) => stdout += data);
        proc.stderr.on('data', (data) => stderr += data);
        proc.on('close', (code) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr || `Command failed with code ${code}`));
        });
        proc.on('error', (err) => reject(err));
    });
}

/**
 * Sleep utility
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Format bytes to human readable string
 */
const formatSize = (bytes) => {
    if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
    else if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
    else if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
    else return bytes + " bytes";
};

/**
 * Random User Agent selector
 * Updated to modern browser versions (2025/2026) to avoid fingerprinting detection
 */
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0'
];
const getRandomUA = () => userAgents[Math.floor(Math.random() * userAgents.length)];

/**
 * Get realistic browser headers for Pinterest requests
 * Mimics a real desktop Chrome browser session
 */
function getRandomPinterestHeaders() {
    return {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-CH-UA': '"Chromium";v="125", "Google Chrome";v="125", "Not-A.Brand";v="24"',
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
    };
}

/**
 * Download media from WhatsApp message
 */
async function downloadMedia(message, type) {
    const downloadContentFromMessage = await _loadBaileysHelper();
    const stream = await downloadContentFromMessage(message, type);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) { 
        buffer = Buffer.concat([buffer, chunk]); 
    }
    return buffer;
}

/**
 * Translate text using Google Translate
 * Uses HTTP client with proxy support
 */
async function fungsiTranslate(text, targetLang = 'id') {
    try {
        // Sanitize input
        const sanitizedText = security.sanitizeInput(text, 5000);
        
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(sanitizedText)}`;
        const { data } = await httpClient.get(url, { timeout: 5000 });
        return data[0].map(x => x[0]).join(''); 
    } catch (e) { 
        return text; 
    }
}

/**
 * Smart IMDb search with multi-strategy fallback
 * Tries multiple methods to find an IMDb ID for a given query:
 *   1. IMDb Suggestion API (fastest, most reliable)
 *   2. OMDB Search API (?s= returns list of results)
 *   3. DuckDuckGo scrape (last resort)
 * 
 * Uses HTTP client with proxy support
 * @param {string} query - Movie title to search for
 * @param {string} [omdbApiKey] - OMDB API key for strategy #2
 * @returns {Promise<{id: string|null, method: string}>} IMDb ID and method used
 */
async function smartSearchIMDb(query, omdbApiKey = null) {
    // Lazy-load logger to avoid circular dependency
    const logger = require('./logger');

    const sanitizedQuery = security.sanitizeInput(query, 100);

    // --- Strategy 1: IMDb Suggestion API ---
    try {
        // IMDb's autocomplete endpoint — keyed by first letter of the query
        const firstChar = sanitizedQuery.charAt(0).toLowerCase();
        const suggestUrl = `https://v2.sg.media-imdb.com/suggests/${firstChar}/${encodeURIComponent(sanitizedQuery)}.json`;
        const { data: rawJsonp } = await httpClient.get(suggestUrl, {
            headers: { 'User-Agent': getRandomUA() },
            timeout: 5000,
            responseType: 'text'
        });

        // Response is JSONP like: imdb$query({...})  — strip wrapper to get JSON
        const jsonStr = rawJsonp.replace(/^[^(]+\(/, '').replace(/\);?\s*$/, '');
        const suggestData = JSON.parse(jsonStr);

        if (suggestData.d && suggestData.d.length > 0) {
            // Find the first result that is a movie/tvSeries (has an IMDb title ID)
            const match = suggestData.d.find(item =>
                item.id && item.id.startsWith('tt') &&
                (!item.q || item.q === 'feature' || item.q === 'TV movie' ||
                 item.q === 'TV series' || item.q === 'TV mini-series' ||
                 item.q === 'short' || item.q === 'video')
            );
            if (match) {
                logger.info(`smartSearchIMDb: found "${match.l}" (${match.id}) via IMDb Suggestion API`);
                return { id: match.id, method: 'imdb-suggest' };
            }
        }
    } catch (e) {
        logger.debug?.(`smartSearchIMDb: IMDb Suggestion API failed: ${e.message}`);
    }

    // --- Strategy 2: OMDB Search API (?s=) ---
    if (omdbApiKey) {
        try {
            const searchUrl = `http://www.omdbapi.com/?s=${encodeURIComponent(sanitizedQuery)}&apikey=${omdbApiKey}`;
            const { data: searchData } = await httpClient.get(searchUrl, { timeout: 5000 });

            if (searchData.Response === 'True' && searchData.Search && searchData.Search.length > 0) {
                const firstResult = searchData.Search[0];
                logger.info(`smartSearchIMDb: found "${firstResult.Title}" (${firstResult.imdbID}) via OMDB Search API`);
                return { id: firstResult.imdbID, method: 'omdb-search' };
            }
        } catch (e) {
            logger.debug?.(`smartSearchIMDb: OMDB Search API failed: ${e.message}`);
        }
    }

    // --- Strategy 3: DuckDuckGo scrape (last resort) ---
    try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=site:imdb.com/title ${encodeURIComponent(sanitizedQuery)}`;
        const { data: ddgHtml } = await httpClient.get(ddgUrl, {
            headers: { 'User-Agent': getRandomUA() },
            timeout: 5000
        });
        const idMatch = ddgHtml.match(/\/title\/(tt\d{6,10})\/?/);
        if (idMatch && idMatch[1]) {
            logger.info(`smartSearchIMDb: found ${idMatch[1]} via DuckDuckGo scrape`);
            return { id: idMatch[1], method: 'duckduckgo' };
        }
    } catch (e) {
        logger.debug?.(`smartSearchIMDb: DuckDuckGo scrape failed: ${e.message}`);
    }

    logger.warn(`smartSearchIMDb: all strategies exhausted for query "${sanitizedQuery}"`);
    return { id: null, method: 'none' };
}

/**
 * Get valid high-resolution poster URL
 * Uses HTTP client with proxy support
 * Tries multiple HD resolutions, falls back to original if none available
 */
async function getValidPosterUrl(originalUrl) {
    if (!originalUrl || originalUrl === 'N/A') {
        return 'https://via.placeholder.com/600x900?text=No+Poster';
    }
    
    // HD resolutions to try (from highest to lowest)
    const hdResolutions = ['SX2000', 'SX1500', 'SX1200', 'SX1000', 'SX800'];
    
    for (const resolution of hdResolutions) {
        const hdUrl = originalUrl.replace(/\._V1_.*\.jpg$/i, `._V1_${resolution}.jpg`);
        
        try {
            await httpClient.head(hdUrl, { timeout: 2000 });
            return hdUrl;
        } catch {
            // Try next resolution
        }
    }
    
    // All HD attempts failed, return original URL
    return originalUrl;
}

/**
 * Validate and sanitize input (wrapper for security manager)
 */
function sanitizeInput(input, maxLength = 500) {
    return security.sanitizeInput(input, maxLength);
}

/**
 * Generate unique filename
 */
function generateFilename(prefix = 'file', extension = '') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}${extension ? '.' + extension : ''}`;
}

/**
 * Clean up temporary files
 */
async function cleanupFiles(prefix) {
    try {
        const files = await fsPromises.readdir('./');
        const junk = files.filter(x => x.startsWith(prefix));
        await Promise.all(junk.map(j => fsPromises.unlink(j).catch(() => {})));
        return junk.length;
    } catch (e) {
        return 0;
    }
}

/**
 * Check if string is a valid URL
 */
function isValidUrl(string) {
    return /^https?:\/\//i.test(string);
}

module.exports = {
    spawnPromise,
    sleep,
    formatSize,
    getRandomUA,
    getRandomPinterestHeaders,
    downloadMedia,
    fungsiTranslate,
    smartSearchIMDb,
    getValidPosterUrl,
    sanitizeInput,
    generateFilename,
    cleanupFiles,
    isValidUrl
};
