/**
 * Menu Image
 *
 * The picture that sits on top of `.menu`. Resolved in this order:
 *
 *   1. MENU_IMAGE — a file path or an http(s) URL, set by the owner in .env
 *   2. assets/menu.jpg (or .jpeg / .png / .webp) — drop-in replacement
 *   3. A banner drawn here with canvas: bot name, tagline and version
 *
 * Whatever the source, the result is normalised through sharp to a JPEG no
 * wider than 1280px. A 12MB phone photo dropped into assets/ would otherwise
 * be re-sent in full on every `.menu`.
 *
 * Everything is cached in memory. A broken override never takes the menu
 * down: it logs and falls through to the next source, and if even the
 * generated banner fails the caller gets null and sends text only.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const logger = require('./logger');

const ASSET_DIR = path.join(__dirname, '..', 'assets');
const ASSET_NAMES = ['menu.jpg', 'menu.jpeg', 'menu.png', 'menu.webp'];
const FONT_PATHS = [
    path.join(__dirname, '..', 'fonts', 'arialnarrow.ttf'),
    '/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Regular.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf'
];

// A remote override is re-fetched at most this often.
const URL_CACHE_MS = 60 * 60 * 1000;
// Refuse to download anything bigger than this as a menu image.
const MAX_REMOTE_BYTES = 8 * 1024 * 1024;

const WIDTH = 1280;
const HEIGHT = 640;

let cache = null;          // { key, buffer, at }
let fontFamily = null;     // resolved once

/**
 * Normalise any image buffer to a reasonably sized JPEG.
 * @param {Buffer} input
 * @returns {Promise<Buffer>}
 */
async function normalise(input) {
    return sharp(input)
        .rotate() // honour EXIF orientation from phone photos
        .resize({ width: WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
}

/**
 * @returns {string|null} Path of the first drop-in asset that exists
 */
function findAsset() {
    for (const name of ASSET_NAMES) {
        const candidate = path.join(ASSET_DIR, name);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Register the narrow font the banner is drawn in, once.
 * @returns {string} Font family to use
 */
function resolveFont() {
    if (fontFamily) return fontFamily;
    const { registerFont } = require('canvas');
    for (const fontPath of FONT_PATHS) {
        try {
            if (fs.existsSync(fontPath)) {
                registerFont(fontPath, { family: 'HamMenu' });
                fontFamily = 'HamMenu';
                return fontFamily;
            }
        } catch {
            // try the next one
        }
    }
    fontFamily = 'sans-serif';
    return fontFamily;
}

/**
 * Shrink a font size until the text fits the given width.
 * @private
 */
function fitFont(g, text, family, startPx, maxWidth, minPx = 40) {
    let px = startPx;
    g.font = `${px}px ${family}`;
    while (px > minPx && g.measureText(text).width > maxWidth) {
        px -= 4;
        g.font = `${px}px ${family}`;
    }
    return px;
}

/**
 * Four-point sparkle, the ✦ shape drawn with curves.
 * @private
 */
function sparkle(g, x, y, s) {
    g.beginPath();
    g.moveTo(x, y - s);
    g.quadraticCurveTo(x, y, x + s, y);
    g.quadraticCurveTo(x, y, x, y + s);
    g.quadraticCurveTo(x, y, x - s, y);
    g.quadraticCurveTo(x, y, x, y - s);
    g.fill();
}

/**
 * Draw the default banner.
 * @returns {Buffer} JPEG
 */
function renderBanner() {
    const { createCanvas } = require('canvas');
    const family = resolveFont();
    const c = createCanvas(WIDTH, HEIGHT);
    const g = c.getContext('2d');

    // Night-sky gradient, violet into a warm corner.
    const bg = g.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, '#140b2e');
    bg.addColorStop(0.55, '#3a1c71');
    bg.addColorStop(1, '#d76d77');
    g.fillStyle = bg;
    g.fillRect(0, 0, WIDTH, HEIGHT);

    // Soft glows.
    for (const [x, y, r, color] of [
        [1060, 110, 280, 'rgba(255,175,123,0.35)'],
        [170, 580, 320, 'rgba(120,90,255,0.30)'],
        [700, 320, 200, 'rgba(255,255,255,0.05)']
    ]) {
        const glow = g.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, color);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, WIDTH, HEIGHT);
    }

    // Dot grid.
    g.fillStyle = 'rgba(255,255,255,0.07)';
    for (let x = 40; x < WIDTH; x += 40) {
        for (let y = 40; y < HEIGHT; y += 40) {
            g.beginPath();
            g.arc(x, y, 1.6, 0, Math.PI * 2);
            g.fill();
        }
    }

    // Sparkles.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, s] of [[1000, 480, 16], [1150, 290, 10], [250, 120, 12], [560, 560, 8], [1190, 575, 9]]) {
        sparkle(g, x, y, s);
    }

    // Frosted card.
    const cx = 100;
    const cy = 170;
    const cw = 860;
    const ch = 310;
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(cx, cy, cw, ch, 36);
    g.fill();
    g.stroke();

    const textLeft = cx + 60;
    const textWidth = cw - 120;

    // Bot name, shrunk to fit however long BOT_NAME is.
    const name = String(config.bot.name || 'HamBot').toUpperCase();
    fitFont(g, name, family, 150, textWidth);
    g.fillStyle = '#ffffff';
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 24;
    g.textBaseline = 'alphabetic';
    g.fillText(name, textLeft, cy + 180);
    g.shadowBlur = 0;

    // Tagline.
    const tagline = config.bot.tagline;
    fitFont(g, tagline, family, 46, textWidth, 24);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(tagline, textLeft, cy + 250);

    // Pill badge on the card's top edge, sized to its text.
    const badge = `v${config.bot.version}  ·  MENU`;
    g.font = `32px ${family}`;
    const padX = 26;
    const pillW = g.measureText(badge).width + padX * 2;
    g.fillStyle = 'rgba(255,255,255,0.94)';
    g.beginPath();
    g.roundRect(textLeft, cy - 30, pillW, 58, 29);
    g.fill();
    g.fillStyle = '#3a1c71';
    g.fillText(badge, textLeft + padX, cy + 11);

    return c.toBuffer('image/jpeg', { quality: 0.9 });
}

/**
 * Fetch a remote override.
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function fetchRemote(url) {
    const httpClient = require('./http-client');
    const { data } = await httpClient.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        maxContentLength: MAX_REMOTE_BYTES
    });
    return Buffer.from(data);
}

/**
 * Load one source, or throw.
 * @param {{type: string, value?: string}} source
 * @returns {Promise<Buffer>}
 */
async function load(source) {
    if (source.type === 'url') return normalise(await fetchRemote(source.value));
    if (source.type === 'file') return normalise(await fs.promises.readFile(source.value));
    return normalise(renderBanner());
}

/**
 * Sources to try, most specific first. Each carries a cache key that changes
 * when the underlying image does (file mtime, bot name/version).
 * @returns {Array<{type: string, value?: string, key: string}>}
 */
function sources() {
    const list = [];
    const override = (process.env.MENU_IMAGE || '').trim();

    if (/^https?:\/\//i.test(override)) {
        list.push({ type: 'url', value: override, key: `url:${override}` });
    } else if (override) {
        const file = path.resolve(override);
        const mtime = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
        list.push({ type: 'file', value: file, key: `file:${file}:${mtime}` });
    }

    const asset = findAsset();
    if (asset) {
        list.push({ type: 'file', value: asset, key: `file:${asset}:${fs.statSync(asset).mtimeMs}` });
    }

    list.push({
        type: 'generated',
        key: `generated:${config.bot.name}:${config.bot.version}:${config.bot.tagline}`
    });
    return list;
}

/**
 * The menu image as a JPEG buffer, or null if nothing could be produced.
 * @returns {Promise<Buffer|null>}
 */
async function getMenuImage() {
    for (const source of sources()) {
        const fresh = cache && cache.key === source.key &&
            (source.type !== 'url' || Date.now() - cache.at < URL_CACHE_MS);
        if (fresh) return cache.buffer;

        try {
            const buffer = await load(source);
            cache = { key: source.key, buffer, at: Date.now() };
            return buffer;
        } catch (error) {
            logger.warn(`Menu image: ${source.type} source failed (${error.message}), trying next`);
        }
    }
    return null;
}

/** Forget the cached image (tests, or after the owner swaps assets). */
function clearCache() {
    cache = null;
}

module.exports = { getMenuImage, renderBanner, clearCache, ASSET_DIR };
