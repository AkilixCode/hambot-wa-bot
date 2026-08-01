/**
 * Music Command
 * Search and download music, then send it as an MP3.
 *
 * THE BLOCKING PROBLEM, AND WHAT THIS DOES ABOUT IT.
 *
 * The bot runs on a datacenter VPS. YouTube rejects those IPs at the player
 * layer — measured directly from this server, an InnerTube player request
 * returns UNPLAYABLE with zero formats. No amount of header spoofing, cookie
 * juggling or stealth browsing changes that, because the IP's ASN is the
 * signal being used. Previous attempts at all three failed for that reason.
 *
 * So there are two real levers, and this command uses both:
 *
 *   1. A residential exit. `.security proxy on` routes yt-dlp through the
 *      owner's home connection (see utils/egress.js). This is the fix that
 *      actually works, which is why it is a live toggle rather than a
 *      redeploy.
 *
 *   2. A different source. SoundCloud does not gate on datacenter IPs and
 *      yt-dlp searches it natively. When YouTube returns a bot check, the
 *      cascade falls through and the user still gets their song — which is
 *      what makes this command usable with the proxy switched off.
 *
 * PO tokens and a current yt-dlp (see utils/ytdlp.js) raise the odds on tier 1
 * but do not guarantee it, so the fallback is not optional.
 */

const CommandBase = require('./base');
const { generateFilename, isValidUrl } = require('../utils/helpers');
const security = require('../utils/security');
const ui = require('../utils/ui');
const config = require('../config');
const logger = require('../utils/logger');
const ytdlp = require('../utils/ytdlp');
const media = require('../utils/media');
const tempdir = require('../utils/tempdir');
const { runProviders } = require('../utils/providers');
const { identifyPlatform, getPlatformArgs, getSupportedPlatformsText } = require('../utils/url-parser');

class MusicCommand extends CommandBase {
    constructor() {
        super({
            name: 'music',
            aliases: ['song', 'mp3', 'audio', 'lagu'],
            description: 'Cari dan unduh musik YouTube',
            usage: '.music <nama lagu>',
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
                icon: '🎵',
                title: 'Music Downloader',
                description: 'Cari lagu lalu unduh sebagai MP3, atau tempel URL langsung.',
                usage: ['.music <nama lagu>', '.music <url>'],
                examples: [
                    '.music About You The 1975',
                    '.music Bohemian Rhapsody Queen',
                    '.music https://youtu.be/dQw4w9WgXcQ',
                    '.music https://soundcloud.com/artist/track'
                ],
                notes: [
                    `Durasi maksimal ${Math.floor(config.media.maxDuration / 60)} menit`,
                    `Ukuran maksimal ${media.sizeLimitLabel()}`,
                    `Platform: ${ui.truncate(supported.audio, 180)}`
                ]
            });
        }

        await this.react(sock, msg, '🔍');

        const query = args.join(' ');
        const isUrl = isValidUrl(query);
        const filePrefix = generateFilename('music', '');

        // A direct URL gets fetched by yt-dlp, so it needs the SSRF guard. A
        // plain search term never reaches the network as a URL.
        if (isUrl) {
            const reachable = await security.resolvesToPublicHost(query);
            if (!reachable.safe) {
                return await this.replyError(sock, from, msg, reachable.reason, { title: 'URL Ditolak' });
            }
        }

        logger.info(`Music: searching "${query}"${isUrl ? ' (direct URL)' : ''}`);

        try {
            await this.react(sock, msg, '🎵');

            const track = isUrl
                ? await this.resolveUrl(query)
                : await this.resolveSearch(query);

            if (track.duration && track.duration > config.media.maxDuration) {
                return await this.replyError(sock, from, msg,
                    'Lagunya kepanjangan. Coba yang lebih pendek ya!', {
                        title: 'Terlalu Panjang',
                        hint: [`Maksimal ${Math.floor(config.media.maxDuration / 60)} menit`]
                    });
            }

            const file = await this.downloadAudio(track, filePrefix);

            if (!media.isWithinSizeLimit(file.size)) {
                return await this.replyError(sock, from, msg,
                    `Filenya kegedean (${require('../utils/helpers').formatSize(file.size)}).`, {
                        title: 'File Kegedean',
                        hint: [`Batasnya ${media.sizeLimitLabel()}`, 'Coba lagu yang lebih pendek']
                    });
            }

            logger.info(`Music: sending ${(file.size / 1024 / 1024).toFixed(1)}MB audio`);

            // Hand Baileys the path, not the bytes. It streams from disk
            // (createReadStream), so a large file no longer has to sit in the
            // heap in its entirety before sending.
            await this.replyMedia(sock, from, msg, {
                audio: { url: file.path },
                mimetype: 'audio/mpeg',
                fileName: `${this.sanitizeFilename(track.title)}.mp3`
            });

            // Sent separately: WhatsApp does not render captions on audio.
            await this.reply(sock, from, msg, this.buildInfoCard(track));
            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, context);
            const described = media.describeError(error, 'musik');
            await this.replyError(sock, from, msg, described.reason, {
                title: described.title,
                hint: described.hint
            });
        } finally {
            await tempdir.cleanupTemp(filePrefix);
        }
    }

    /**
     * Resolve metadata for a URL the user supplied directly.
     *
     * Metadata failure is not fatal here — some extractors are flaky on
     * --dump-json but download fine, and refusing to try would be a regression.
     *
     * @param {string} url
     * @returns {Promise<Object>} Track descriptor
     */
    async resolveUrl(url) {
        const platformArgs = getPlatformArgs(url);
        const platform = identifyPlatform(url);
        const isYouTube = /youtu\.?be/i.test(url);
        const extraArgs = isYouTube ? [...platformArgs, ...ytdlp.getYouTubeArgs()] : platformArgs;

        try {
            const [info] = await ytdlp.getInfo(url, { extraArgs });
            if (info) {
                return {
                    url,
                    title: info.title || 'Audio',
                    uploader: info.uploader || info.channel || null,
                    duration: info.duration || 0,
                    source: platform ? platform.platform : 'URL',
                    extraArgs
                };
            }
        } catch (error) {
            logger.debug(`Music: metadata lookup failed, continuing - ${error.message}`);
        }

        return { url, title: 'Audio', uploader: null, duration: 0, source: platform ? platform.platform : 'URL', extraArgs };
    }

    /**
     * Find a track for a search term, YouTube first and SoundCloud second.
     *
     * @param {string} query - Search terms
     * @returns {Promise<Object>} Track descriptor, with `degraded` set when the
     *                            fallback source was used
     */
    async resolveSearch(query) {
        const outcome = await runProviders('music-search', [
            {
                id: 'youtube',
                label: 'YouTube',
                run: () => this.searchYouTube(query)
            },
            {
                id: 'soundcloud',
                label: 'SoundCloud',
                run: () => this.searchSoundCloud(query)
            }
        ]);

        return { ...outcome.result, degraded: outcome.degraded, source: outcome.providerLabel };
    }

    /**
     * Search YouTube.
     * @param {string} query
     * @returns {Promise<Object>} Track descriptor
     */
    async searchYouTube(query) {
        const results = await ytdlp.getInfo(`ytsearch5:${query}`, {
            flat: true,
            extraArgs: ytdlp.getYouTubeArgs()
        });

        const pick = this.pickTrack(results);
        if (!pick) throw new Error('No suitable YouTube result');

        return {
            url: `https://youtu.be/${pick.id}`,
            title: pick.title || 'Audio',
            uploader: pick.uploader || pick.channel || null,
            duration: pick.duration || 0,
            extraArgs: ytdlp.getYouTubeArgs()
        };
    }

    /**
     * Search SoundCloud.
     *
     * Reachable from datacenter IPs and free of bot checks, which is exactly
     * why it is the fallback. `scsearch` is built into yt-dlp — no API key and
     * no third-party service to go stale.
     *
     * @param {string} query
     * @returns {Promise<Object>} Track descriptor
     */
    async searchSoundCloud(query) {
        const results = await ytdlp.getInfo(`scsearch5:${query}`, { flat: true });

        const pick = this.pickTrack(results);
        if (!pick) throw new Error('No suitable SoundCloud result');

        return {
            // Flat search results may omit a usable webpage_url, so fall back
            // to re-running the search and taking the first hit at download time.
            url: pick.url || pick.webpage_url || `scsearch1:${query}`,
            title: pick.title || 'Audio',
            uploader: pick.uploader || null,
            duration: pick.duration || 0,
            extraArgs: []
        };
    }

    /**
     * Choose the first result inside the duration limit.
     *
     * Entries with no duration are accepted as a last resort: flat search
     * results sometimes omit it, and rejecting them would discard usable hits.
     *
     * @param {Object[]} results
     * @returns {Object|null}
     */
    pickTrack(results) {
        if (!Array.isArray(results) || results.length === 0) return null;

        const withinLimit = results.find(r => r.duration && r.duration <= config.media.maxDuration);
        if (withinLimit) return withinLimit;

        return results.find(r => !r.duration) || null;
    }

    /**
     * Download and transcode to MP3.
     *
     * No -f selector by design: let yt-dlp take the best stream it can get and
     * convert afterwards. Pinning a format is a common cause of "requested
     * format not available" when a site changes its ladder.
     *
     * @param {Object} track - Track descriptor
     * @param {string} filePrefix - Temp filename prefix
     * @returns {Promise<{path: string, name: string, size: number}>}
     */
    async downloadAudio(track, filePrefix) {
        const outputTemplate = tempdir.tempPath(`${filePrefix}.%(ext)s`);

        await ytdlp.download(
            track.url,
            outputTemplate,
            ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
            {
                maxFilesize: config.media.maxFileSize,
                extraArgs: track.extraArgs || []
            }
        );

        const file = await media.findDownload(filePrefix, ['mp3', 'm4a', 'opus', 'ogg']);
        if (!file) {
            throw new Error('Downloaded file not found — it may have exceeded max-filesize');
        }
        return file;
    }

    /**
     * Build the info card that follows the audio message.
     * @param {Object} track - Track descriptor
     * @returns {string} Rendered card
     */
    buildInfoCard(track) {
        const lines = [ui.kv('Judul', ui.safe(ui.truncate(track.title, 80)), '🎵')];

        if (track.uploader) {
            lines.push(ui.kv('Artis', ui.safe(ui.truncate(track.uploader, 60)), '👤'));
        }
        if (track.duration) {
            lines.push(ui.kv('Durasi', ui.duration(track.duration * 1000), '⏱️'));
        }

        return ui.card({
            icon: '🎧',
            title: 'Musik Terkirim',
            lines,
            footer: track.degraded
                ? `Sumber: ${track.source} ${ui.SYM.dot} ${ui.clock()}`
                : `${ui.EMOJI.live} ${track.source || 'YouTube'} ${ui.SYM.dot} ${ui.clock()}`
        });
    }

    /**
     * Strip characters that are unsafe in a filename WhatsApp will display.
     * @param {string} title
     * @returns {string}
     */
    sanitizeFilename(title) {
        return String(title || 'audio')
            .replace(/[/\\?%*:|"<>]/g, '')
            .trim()
            .substring(0, 60) || 'audio';
    }
}

module.exports = MusicCommand;
