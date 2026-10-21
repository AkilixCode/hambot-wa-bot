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
const providers = require('../utils/providers');
const { identifyPlatform, getPlatformArgs, getSupportedPlatformsText } = require('../utils/url-parser');

// Breaker for YouTube *downloads*. Searching YouTube usually works from a
// datacenter IP; the bot check hits when the audio itself is fetched. After a
// few refused downloads in a row, searches go straight to SoundCloud for a
// while instead of finding a YouTube hit that cannot be downloaded.
const YOUTUBE_DOWNLOAD_ID = 'youtube-download';

// yt-dlp failures (utils/ytdlp failureReason) where another source can still
// give the user the song they searched for. Network, proxy and timeout
// failures are not here: SoundCloud would sit behind the same problem.
const FALLBACK_REASONS = new Set(['bot-check', 'geo-blocked', 'unavailable', 'private']);

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

        // A pasted URL is used on its own: words after it would otherwise
        // become part of the "URL" yt-dlp is asked to fetch.
        const isUrl = isValidUrl(args[0]);
        const query = isUrl ? args[0] : args.join(' ');
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

            let track = isUrl
                ? this.resolveUrl(query)
                : await this.resolveSearch(query);

            if (track.duration && track.duration > config.media.maxDuration) {
                return await this.replyError(sock, from, msg,
                    'Lagunya kepanjangan. Coba yang lebih pendek ya!', {
                        title: 'Terlalu Panjang',
                        hint: [`Maksimal ${Math.floor(config.media.maxDuration / 60)} menit`]
                    });
            }

            const downloaded = await this.downloadWithFallback(track, query, isUrl, filePrefix);
            track = downloaded.track;
            const { file, tooLong } = downloaded;
            if (tooLong) {
                return await this.replyError(sock, from, msg,
                    'Lagunya kepanjangan. Coba yang lebih pendek ya!', {
                        title: 'Terlalu Panjang',
                        hint: [`Maksimal ${Math.floor(config.media.maxDuration / 60)} menit`]
                    });
            }

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
     * Describe a URL the user supplied directly.
     *
     * No metadata lookup here: the download reads it in the same yt-dlp run
     * (see downloadAudio), which also enforces the duration limit.
     *
     * @param {string} url
     * @returns {Object} Track descriptor, filled in after the download
     */
    resolveUrl(url) {
        const platformArgs = getPlatformArgs(url);
        const platform = identifyPlatform(url);
        const isYouTube = /youtu\.?be/i.test(url);
        const extraArgs = isYouTube ? [...platformArgs, ...ytdlp.getYouTubeArgs()] : platformArgs;

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
        const sources = [
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
        ];
        // YouTube downloads keep being refused: a YouTube hit would only fail
        // at the download, so do not look for one.
        const usable = providers.isOpen(YOUTUBE_DOWNLOAD_ID) ? sources.slice(1) : sources;
        const outcome = await providers.runProviders('music-search', usable);

        return {
            ...outcome.result,
            degraded: outcome.degraded || usable.length < sources.length,
            source: outcome.providerLabel
        };
    }

    /**
     * Download the track; when a YouTube search hit is refused (the bot
     * check usually lands here, not at the search), search SoundCloud and
     * download from there instead. Once, never a loop.
     *
     * A URL the user pasted is never swapped for a different song.
     *
     * @param {Object} track - Track descriptor
     * @param {string} query - The search terms (or the URL)
     * @param {boolean} isUrl - Whether the user pasted a URL
     * @param {string} filePrefix - Temp filename prefix
     * @returns {Promise<{track: Object, file?: Object, tooLong: boolean}>}
     */
    async downloadWithFallback(track, query, isUrl, filePrefix) {
        const fromYouTube = !isUrl && track.source === 'YouTube';
        try {
            const result = await this.downloadAudio(track, filePrefix);
            if (fromYouTube) providers.recordSuccess(YOUTUBE_DOWNLOAD_ID);
            return { track, ...result };
        } catch (error) {
            if (!fromYouTube || !FALLBACK_REASONS.has(ytdlp.failureReason(error))) throw error;
            providers.recordFailure(YOUTUBE_DOWNLOAD_ID, error);
            logger.info(`Music: YouTube refused the download (${ytdlp.failureReason(error)}), trying SoundCloud`);

            await tempdir.cleanupTemp(filePrefix);
            let fallback;
            try {
                fallback = { ...(await this.searchSoundCloud(query)), degraded: true, source: 'SoundCloud' };
            } catch {
                // Nothing on SoundCloud either: YouTube's reason is the useful one.
                throw error;
            }
            return { track: fallback, ...(await this.downloadAudio(fallback, filePrefix)) };
        }
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
     * @param {Object} track - Track descriptor; filled in from the run's metadata
     * @param {string} filePrefix - Temp filename prefix
     * @returns {Promise<{file?: {path: string, name: string, size: number}, tooLong: boolean}>}
     */
    async downloadAudio(track, filePrefix) {
        const outputTemplate = tempdir.tempPath(`${filePrefix}.%(ext)s`);

        const { info, tooLong } = await ytdlp.downloadWithInfo(
            track.url,
            outputTemplate,
            ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
            {
                maxFilesize: config.media.maxFileSize,
                maxDuration: config.media.maxDuration,
                extraArgs: track.extraArgs || []
            }
        );

        // A direct URL arrives with placeholders; the same run supplied the
        // real title and length for the info card.
        if (info) {
            if (track.title === 'Audio' && info.title) track.title = info.title;
            track.uploader = track.uploader || info.uploader || info.channel || null;
            track.duration = track.duration || info.duration || 0;
        }

        // A file on disk wins over the "no metadata, so filtered" inference.
        const file = await media.findDownload(filePrefix, ['mp3', 'm4a', 'opus', 'ogg']);
        if (!file) {
            if (tooLong) return { tooLong: true };
            throw new Error('Downloaded file not found — it may have exceeded max-filesize');
        }
        return { file, tooLong: false };
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
