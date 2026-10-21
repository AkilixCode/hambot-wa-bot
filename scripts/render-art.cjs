/**
 * Regenerate the logo and README art from code (utils/logo.js and the
 * .menu banner in utils/menu-image.js), so the images never drift from
 * what the bot draws itself.
 *
 *   node scripts/render-art.cjs [output dir]     (default: docs/images)
 *
 * Writes:
 *   logo.svg    the vector master
 *   logo.png    512×512, transparent
 *   avatar.png  640×640 on the night-sky background: the bot's WhatsApp
 *               profile picture and the GitHub social preview
 *   banner.jpg  the README banner
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'docs', 'images'));

// The README banner shows the bot's own name, not whatever BOT_NAME a
// local .env sets.
process.env.BOT_NAME = 'HamBot';

const { createCanvas } = require('canvas');
const { drawLogo, toSvg } = require('../utils/logo');
const { renderBanner, drawBackground } = require('../utils/menu-image');

fs.mkdirSync(out, { recursive: true });

fs.writeFileSync(path.join(out, 'logo.svg'), toSvg());

const logo = createCanvas(512, 512);
drawLogo(logo.getContext('2d'), 0, 0, 512);
fs.writeFileSync(path.join(out, 'logo.png'), logo.toBuffer('image/png'));

// Profile pictures are cropped to a circle: keep the mark well inside it.
const avatar = createCanvas(640, 640);
const g = avatar.getContext('2d');
drawBackground(g, 640, 640, { sparkles: [[230, 120, 18], [1080, 540, 22], [160, 520, 14]] });
drawLogo(g, 110, 104, 420, { shadow: true, outline: true });
fs.writeFileSync(path.join(out, 'avatar.png'), avatar.toBuffer('image/png'));

fs.writeFileSync(path.join(out, 'banner.jpg'), renderBanner({
    badge: 'WHATSAPP BOT  ·  AI',
    tagline: 'AI chat, media, stickers and network tools'
}));

for (const file of ['logo.svg', 'logo.png', 'avatar.png', 'banner.jpg']) {
    console.log(`${file.padEnd(11)} ${fs.statSync(path.join(out, file)).size} bytes`);
}
