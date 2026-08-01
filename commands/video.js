/**
 * Video Command
 * Download videos from various platforms (TikTok, Instagram, Facebook, YouTube, etc.)
 * Supports 30+ platforms including short URLs (vt.tiktok.com, youtu.be, fb.watch, etc.)
 *
 * Unlike .music this has no alternative source to fall back to — a request for
 * one specific video cannot be satisfied by a different one. When YouTube
 * blocks the server, the answer is the residential proxy toggle
 * (`.security proxy on`, see utils/egress.js). Most other platforms this
 * command handles — TikTok, Instagram, Facebook, X — do not gate on datacenter
 * IPs, so they keep working either way.
 */

const CommandBase = require('./base');
const { generateFilename, isValidUrl, formatSize } = require('../utils/helpers');
const security = require('../utils/security');
const ui = require('../utils/ui');
const config = require('../config');
const logger = require('../utils/logger');
const ytdlp = require('../utils/ytdlp');
const media = require('../utils/media');
const tempdir = require('../utils/tempdir');
const { identifyPlatform, getPlatformArgs, getSupportedPlatformsText } = require('../utils/url-parser');

// Prefer a ready-made mp4, then a merged mp4, then whatever exists. Kept
// permissive on purpose: an over-specific selector is the usual cause of
// "Requested format is not available" when a site changes its format ladder.
const VIDEO_FORMAT_SELECTOR = 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';

class VideoCommand extends CommandBase {
    constructor() {
        super({
            name: 'video',
            aliases: ['vid', 'dl', 'download'],
            description: 'Unduh video dari banyak platform',
            usage: '.video <url>',
            category: 'media',
            cooldown: 5000,
            isHeavy: true
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            const supported = getSupportedPlatformsText();
            return await this.replyUsage(sock, from, msg, {
                icon: '📹',
                title: 'Video Downloader',
                description: 'Unduh video dari berbagai platform sosial media.',
                usage: ['.video <url>'],
                examples: [
                    '.video https://vt.tiktok.com/xxxxx/',
                    '.video https://youtu.be/dQw4w9WgXcQ',
                    '.video https://instagram.com/reel/xxxxx',
                    '.video https://fb.watch/xxxxx/',
                    '.video https://x.com/user/status/123456'
                ],
                notes: [
                    `Maksimal ${media.sizeLimitLabel()} per video`,
                    `Durasi maksimal ${Math.floor(config.media.maxDuration / 60)} menit`,
                    `Platform: ${ui.truncate(supported.video, 180)}`
                ]
            });
        }

        const url = args[0];

        if (!isValidUrl(url)) {
            return await this.replyError(sock, from, msg,
                'URL harus dimulai dengan http:// atau https://', {
                    title: 'URL Tidak Valid',
                    hint: ['.video https://youtu.be/dQw4w9WgXcQ']
                });
        }

        try {
            new URL(url);
        } catch {
            return await this.replyError(sock, from, msg,
                'Format URL tidak lengkap atau salah ketik.', {
                    title: 'URL Tidak Valid',
                    hint: ['Salin ulang tautannya langsung dari aplikasi asal']
                });
        }

        // The checks above are syntactic. A hostname the sender controls can
        // still resolve to an internal address, so confirm where it actually
        // points before handing the URL to yt-dlp.
        const reachable = await security.resolvesToPublicHost(url);
        if (!reachable.safe) {
            return await this.replyError(sock, from, msg, reachable.reason, { title: 'URL Ditolak' });
        }

        const platformInfo = identifyPlatform(url);
        logger.info(`Video: processing "${url}" (platform: ${platformInfo ? platformInfo.platform : 'unknown'})`);

        await this.react(sock, msg, platformInfo ? '📹' : '🔍');

        const filePrefix = generateFilename('video', '');

        // An unrecognised URL is still handed to yt-dlp — it supports far more
        // sites than url-parser.js knows about.
        const platformArgs = getPlatformArgs(url);
        const isYouTube = /youtu\.?be/i.test(url);
        const extraArgs = isYouTube ? [...platformArgs, ...ytdlp.getYouTubeArgs()] : platformArgs;

        try {
            const info = await this.fetchInfo(url, extraArgs);

            if (info.duration && info.duration > config.media.maxDuration) {
                return await this.replyError(sock, from, msg,
                    'Videonya kepanjangan. Coba yang lebih pendek ya!', {
                        title: 'Terlalu Panjang',
                        hint: [`Maksimal ${Math.floor(config.media.maxDuration / 60)} menit`]
                    });
            }

            await this.react(sock, msg, '⏳');

            const file = await this.downloadVideo(url, filePrefix, extraArgs);

            if (!media.isWithinSizeLimit(file.size)) {
                return await this.replyError(sock, from, msg,
                    `Filenya kegedean (${formatSize(file.size)}).`, {
                        title: 'File Kegedean',
                        hint: [`Batasnya ${media.sizeLimitLabel()}`, 'Coba video yang lebih pendek']
                    });
            }

            logger.info(`Video: sending ${(file.size / 1024 / 1024).toFixed(1)}MB video`);

            // Stream from disk rather than buffering the whole file — see the
            // same note in music.js.
            await this.replyMedia(sock, from, msg, {
                video: { url: file.path },
                mimetype: 'video/mp4',
                caption: this.buildCaption(info, platformInfo)
            });

            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, context);
            const described = media.describeError(error, 'video');
            await this.replyError(sock, from, msg, described.reason, {
                title: described.title,
                hint: described.hint
            });
        } finally {
            await tempdir.cleanupTemp(filePrefix);
        }
    }

    /**
     * Fetch video metadata.
     *
     * Failure is tolerated: several extractors are unreliable on --dump-json
     * but download perfectly well, so a metadata error must not block the
     * download. The caption simply gets thinner.
     *
     * @param {string} url
     * @param {string[]} extraArgs - Platform-specific yt-dlp args
     * @returns {Promise<Object>} Metadata, possibly mostly empty
     */
    async fetchInfo(url, extraArgs) {
        try {
            const [info] = await ytdlp.getInfo(url, { extraArgs });
            return info || {};
        } catch (error) {
            logger.debug(`Video: metadata lookup failed, continuing - ${error.message}`);
            return {};
        }
    }

    /**
     * Download the video.
     * @param {string} url
     * @param {string} filePrefix - Temp filename prefix
     * @param {string[]} extraArgs - Platform-specific yt-dlp args
     * @returns {Promise<{path: string, name: string, size: number}>}
     */
    async downloadVideo(url, filePrefix, extraArgs) {
        const outputTemplate = tempdir.tempPath(`${filePrefix}.%(ext)s`);

        await ytdlp.download(
            url,
            outputTemplate,
            ['-f', VIDEO_FORMAT_SELECTOR, '--merge-output-format', 'mp4'],
            { maxFilesize: config.media.maxFileSize, extraArgs }
        );

        const file = await media.findDownload(filePrefix, ['mp4', 'mkv', 'webm']);
        if (!file) {
            throw new Error('Downloaded file not found — it may have exceeded max-filesize');
        }
        return file;
    }

    /**
     * Build the caption shown under the video.
     *
     * Goes out through replyMedia, which clamps to WhatsApp's 1024-character
     * caption limit. The previous version called sock.sendMessage directly and
     * skipped that clamp entirely.
     *
     * @param {Object} info - yt-dlp metadata
     * @param {Object|null} platformInfo - Result of identifyPlatform
     * @returns {string} Rendered card
     */
    buildCaption(info, platformInfo) {
        const lines = [];

        if (info.uploader || info.channel) {
            lines.push(ui.kv('Uploader', ui.safe(ui.truncate(info.uploader || info.channel, 50)), '👤'));
        }

        if (info.upload_date && info.upload_date.length === 8) {
            const d = info.upload_date;
            lines.push(ui.kv('Tanggal', `${d.substring(6, 8)}-${d.substring(4, 6)}-${d.substring(0, 4)}`, '📅'));
        }

        if (info.view_count) {
            lines.push(ui.kv('Ditonton', ui.compactNumber(info.view_count), '👁️'));
        }

        if (info.like_count) {
            lines.push(ui.kv('Suka', ui.compactNumber(info.like_count), '❤️'));
        }

        if (info.duration) {
            lines.push(ui.kv('Durasi', ui.duration(info.duration * 1000), '⏱️'));
        }

        const title = ui.safe(ui.truncate(info.title || 'Video', 70));

        return ui.card({
            icon: '📹',
            title,
            lines: lines.length ? lines : ['Video berhasil diunduh.'],
            footer: `${platformInfo ? platformInfo.platform : 'Video'} ${ui.SYM.dot} ${ui.clock()}`
        });
    }
}

module.exports = VideoCommand;
