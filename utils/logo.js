/**
 * HamBot Logo
 *
 * A friendly robot in a speech bubble: a WhatsApp bot that talks, with the
 * ✦ sparkle for AI. One geometry table drives both outputs —
 * drawLogo() for canvas (the .menu banner, the PNGs) and toSvg() for
 * docs/images/logo.svg — so the two can never drift apart.
 *
 * Coordinates are on a 512×512 grid; everything scales from there.
 * Regenerate the images with: node scripts/render-art.cjs
 */

const GRID = 512;

const COLORS = {
    bubbleFrom: '#5b2aa6',
    bubbleTo: '#d76d77',
    mark: '#ffffff',
    face: '#2a1458',
    ball: '#ffaf7b',
    sparkle: '#ffe2c6'
};

const GEOMETRY = {
    bubble: { x: 40, y: 56, w: 432, h: 328, r: 104 },
    // The tail, lower left: base on the bubble's bottom edge, tip outside.
    tail: { x1: 112, x2: 220, tipX: 84, tipY: 468 },
    head: { x: 146, y: 160, w: 220, h: 160, r: 52 },
    ears: [
        { x: 120, y: 208, w: 30, h: 64, r: 14 },
        { x: 362, y: 208, w: 30, h: 64, r: 14 }
    ],
    antenna: { x: 256, y1: 162, y2: 116, width: 16 },
    ball: { cx: 256, cy: 102, r: 22 },
    eyes: [
        { cx: 212, cy: 232, r: 24 },
        { cx: 300, cy: 232, r: 24 }
    ],
    // Angles in fractions of π, measured clockwise from 3 o'clock.
    smile: { cx: 256, cy: 252, r: 44, from: 0.25, to: 0.75, width: 14 },
    sparkle: { cx: 424, cy: 84, s: 40 }
};

/** @private Rounded rectangle path on a canvas context. */
function roundRect(g, { x, y, w, h, r }) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
}

/** @private Four-point sparkle, the ✦ shape drawn with curves. */
function sparklePath(g, { cx, cy, s }) {
    g.beginPath();
    g.moveTo(cx, cy - s);
    g.quadraticCurveTo(cx, cy, cx + s, cy);
    g.quadraticCurveTo(cx, cy, cx, cy + s);
    g.quadraticCurveTo(cx, cy, cx - s, cy);
    g.quadraticCurveTo(cx, cy, cx, cy - s);
    g.closePath();
}

/**
 * Draw the logo onto a canvas 2D context.
 * @param {CanvasRenderingContext2D} g
 * @param {number} x - Left edge
 * @param {number} y - Top edge
 * @param {number} size - Width and height
 * @param {Object} [opts]
 * @param {boolean} [opts.shadow] - Soft drop shadow (on busy backgrounds)
 * @param {boolean} [opts.outline] - Soft white edge (on dark backgrounds)
 */
function drawLogo(g, x, y, size, opts = {}) {
    const G = GEOMETRY;
    g.save();
    g.translate(x, y);
    g.scale(size / GRID, size / GRID);

    if (opts.shadow) {
        g.shadowColor = 'rgba(0,0,0,0.35)';
        g.shadowBlur = 36;
        g.shadowOffsetY = 10;
    }

    // Bubble and tail as one shape: one fill, one shadow, no seam.
    const bubble = () => {
        g.beginPath();
        const { x, y, w, h, r } = G.bubble;
        g.moveTo(x + r, y);
        g.arcTo(x + w, y, x + w, y + h, r);
        g.arcTo(x + w, y + h, x, y + h, r);
        g.lineTo(G.tail.x2, y + h);
        g.lineTo(G.tail.tipX, G.tail.tipY);
        g.lineTo(G.tail.x1, y + h);
        g.arcTo(x, y + h, x, y, r);
        g.arcTo(x, y, x + w, y, r);
        g.closePath();
    };

    // On a dark background: a soft white edge, stroked under the fill so
    // only its outer half shows.
    if (opts.outline) {
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.lineWidth = 10;
        g.lineJoin = 'round';
        bubble();
        g.stroke();
        g.shadowColor = 'transparent';
    }

    const fill = g.createLinearGradient(G.bubble.x, G.bubble.y, G.bubble.x + G.bubble.w, G.tail.tipY);
    fill.addColorStop(0, COLORS.bubbleFrom);
    fill.addColorStop(1, COLORS.bubbleTo);
    g.fillStyle = fill;
    bubble();
    g.fill();
    g.shadowColor = 'transparent';

    // Robot: antenna, ears, head.
    g.fillStyle = COLORS.mark;
    g.strokeStyle = COLORS.mark;
    g.lineCap = 'round';
    g.lineWidth = G.antenna.width;
    g.beginPath();
    g.moveTo(G.antenna.x, G.antenna.y1);
    g.lineTo(G.antenna.x, G.antenna.y2);
    g.stroke();
    for (const ear of G.ears) {
        roundRect(g, ear);
        g.fill();
    }
    roundRect(g, G.head);
    g.fill();

    g.fillStyle = COLORS.ball;
    g.beginPath();
    g.arc(G.ball.cx, G.ball.cy, G.ball.r, 0, Math.PI * 2);
    g.fill();

    // Face.
    g.fillStyle = COLORS.face;
    for (const eye of G.eyes) {
        g.beginPath();
        g.arc(eye.cx, eye.cy, eye.r, 0, Math.PI * 2);
        g.fill();
    }
    g.strokeStyle = COLORS.face;
    g.lineWidth = G.smile.width;
    g.beginPath();
    g.arc(G.smile.cx, G.smile.cy, G.smile.r, G.smile.from * Math.PI, G.smile.to * Math.PI);
    g.stroke();

    g.fillStyle = COLORS.sparkle;
    sparklePath(g, G.sparkle);
    g.fill();

    g.restore();
}

/** @private SVG path for a rounded rectangle. */
function svgRoundRect({ x, y, w, h, r }) {
    return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
        `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

/**
 * The logo as a standalone SVG document.
 * @returns {string}
 */
function toSvg() {
    const G = GEOMETRY;
    const round = n => Math.round(n * 100) / 100;
    const point = angle => [round(G.smile.cx + G.smile.r * Math.cos(angle * Math.PI)), round(G.smile.cy + G.smile.r * Math.sin(angle * Math.PI))];
    const [sx, sy] = point(G.smile.from);
    const [ex, ey] = point(G.smile.to);
    const { cx, cy, s } = G.sparkle;
    const { x, y, w, h, r } = G.bubble;
    const bubblePath = `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
        `H${G.tail.x2}L${G.tail.tipX} ${G.tail.tipY}L${G.tail.x1} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    const sparkle = `M${cx} ${cy - s}Q${cx} ${cy} ${cx + s} ${cy}Q${cx} ${cy} ${cx} ${cy + s}Q${cx} ${cy} ${cx - s} ${cy}Q${cx} ${cy} ${cx} ${cy - s}Z`;

    return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${GRID}" height="${GRID}" role="img" aria-label="HamBot">`,
        '  <title>HamBot</title>',
        '  <defs>',
        `    <linearGradient id="bubble" x1="${G.bubble.x}" y1="${G.bubble.y}" x2="${G.bubble.x + G.bubble.w}" y2="${G.tail.tipY}" gradientUnits="userSpaceOnUse">`,
        `      <stop offset="0" stop-color="${COLORS.bubbleFrom}"/>`,
        `      <stop offset="1" stop-color="${COLORS.bubbleTo}"/>`,
        '    </linearGradient>',
        '  </defs>',
        `  <path fill="url(#bubble)" d="${bubblePath}"/>`,
        `  <line x1="${G.antenna.x}" y1="${G.antenna.y1}" x2="${G.antenna.x}" y2="${G.antenna.y2}" stroke="${COLORS.mark}" stroke-width="${G.antenna.width}" stroke-linecap="round"/>`,
        ...G.ears.map(ear => `  <path fill="${COLORS.mark}" d="${svgRoundRect(ear)}"/>`),
        `  <path fill="${COLORS.mark}" d="${svgRoundRect(G.head)}"/>`,
        `  <circle cx="${G.ball.cx}" cy="${G.ball.cy}" r="${G.ball.r}" fill="${COLORS.ball}"/>`,
        ...G.eyes.map(eye => `  <circle cx="${eye.cx}" cy="${eye.cy}" r="${eye.r}" fill="${COLORS.face}"/>`),
        `  <path d="M${sx} ${sy}A${G.smile.r} ${G.smile.r} 0 0 1 ${ex} ${ey}" fill="none" stroke="${COLORS.face}" stroke-width="${G.smile.width}" stroke-linecap="round"/>`,
        `  <path fill="${COLORS.sparkle}" d="${sparkle}"/>`,
        '</svg>',
        ''
    ].join('\n');
}

module.exports = { drawLogo, toSvg, GEOMETRY, COLORS, GRID };
