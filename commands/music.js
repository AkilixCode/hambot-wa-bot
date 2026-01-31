/**
 * Music Command
 * Search and download music from YouTube and other platforms
 * Uses python3 -m yt_dlp with proxy and android client strategy
 * Supports 30+ platforms including short URLs
 */

const CommandBase = require('./base');
const { spawn } = require('child_process');
const { generateFilename, cleanupFiles, isValidUrl } = require('../utils/helpers');
const { identifyPlatform, isAudioSupported, getPlatformArgs, getSupportedPlatformsText } = require('../utils/url-parser');
const fsPromises = require('fs').promises;
const config = require('../config');

class MusicCommand extends CommandBase {
    constructor() {
        super({
            name: 'music',
            aliases: ['song', 'mp3', 'audio', 'lagu'],
            description: 'Cari dan download musik dari YouTube',
            usage: '.music <nama lagu>',
            category: 'media',
            cooldown: 5000,
            isHeavy: true
        });
    }

    /**
     * Execute yt-dlp using python3 -m yt_dlp for plugin support
     * This uses python3 which is in the allowed commands list in helpers.js
     */
    spawnYtDlp(args) {
        return new Promise((resolve, reject) => {
            // python3 is in the allowed commands list in helpers.js
            const proc = spawn('python3', ['-m', 'yt_dlp', ...args]);
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (data) => stdout += data);
            proc.stderr.on('data', (data) => stderr += data);
            proc.on('close', (code) => {
                if (code === 0) resolve(stdout);
                else reject(new Error(stderr || `yt-dlp failed with code ${code}`));
            });
            proc.on('error', (err) => reject(err));
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        // Get supported platforms for help message
        const supportedPlatforms = getSupportedPlatformsText();

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '🎵 *Music Downloader*\n\n' +
                '📝 *Cara Pakai:*\n' +
                '• `.music <nama lagu>` - Cari dan download\n' +
                '• `.music <url>` - Download dari URL langsung\n\n' +
                '🔗 *Contoh:*\n' +
                '• .music About You The 1975\n' +
                '• .music https://youtu.be/xxx\n' +
                '• .music https://soundcloud.com/artist/track\n' +
                '• .music https://open.spotify.com/track/xxx\n\n' +
                `🌐 *Platform Audio Didukung:*\n${supportedPlatforms.audio}`
            );
        }

        await this.react(sock, msg, '🔍');

        const query = args.join(' ');
        const filePrefix = generateFilename('music', '');
        
        // Build proxy args from config - uses getYtDlpProxyArgs method
        const proxyArgs = config.getYtDlpProxyArgs();

        // Check if input is a URL
        const isUrl = isValidUrl(query);
        
        // Get platform info and args if URL
        let platformInfo = null;
        let platformArgs = [];
        if (isUrl) {
            platformInfo = identifyPlatform(query);
            platformArgs = getPlatformArgs(query);
        }

        try {
            let videoUrl;
            let videoTitle = 'Audio';

            if (isUrl) {
                // If URL provided, use it directly
                if (platformInfo) {
                    await this.react(sock, msg, '🎵');
                }
                videoUrl = query;
                
                // Try to get video info with platform-specific args
                try {
                    const infoArgs = [
                        videoUrl,
                        '--dump-json',
                        '--no-playlist',
                        '--force-ipv4',
                        ...platformArgs,
                        ...proxyArgs
                    ];
                    const infoResult = await this.spawnYtDlp(infoArgs);
                    const videoInfo = JSON.parse(infoResult.trim().split('\n')[0]);
                    
                    if (videoInfo.duration && videoInfo.duration > config.media.maxDuration) {
                        return await this.reply(sock, from, msg, '❌ Lagu terlalu panjang. Coba lagu yang lebih pendek ya!');
                    }
                    
                    videoTitle = videoInfo.title || 'Audio';
                } catch (infoError) {
                    // If info extraction fails, continue with download
                    this.logError(infoError, context);
                }
            } else {
                // Step 1: Search for videos and check duration
                await this.react(sock, msg, '🎵');

                const searchArgs = [
                    `ytsearch5:${query}`,
                    '--dump-json',
                    '--no-playlist',
                    '--flat-playlist',
                    '--extractor-args', 'youtube:player_client=android',
                    '--force-ipv4',
                    ...proxyArgs
                ];

                const searchResult = await this.spawnYtDlp(searchArgs);

                const videos = searchResult.trim().split('\n').map(line => {
                    try { return JSON.parse(line); } 
                    catch { return null; }
                }).filter(v => v !== null);

                // Find video with duration < max duration
                const validVideo = videos.find(v => 
                    v.duration && v.duration < config.media.maxDuration
                );

                if (!validVideo) {
                    return await this.reply(sock, from, msg, '❌ Lagu terlalu panjang atau tidak ditemukan. Coba lagu lain ya!');
                }

                videoUrl = `https://youtu.be/${validVideo.id}`;
                videoTitle = validVideo.title;
            }

            // Step 2: Download audio using "Let it Be" method
            // Let yt-dlp download whatever stream is best, then convert to mp3
            const outputPath = `${filePrefix}.%(ext)s`;
            
            // Build download args - use platform-specific args if available (for URLs)
            // For search queries, use YouTube-specific args
            const downloadPlatformArgs = isUrl ? platformArgs : ['--extractor-args', 'youtube:player_client=android'];
            
            const downloadArgs = [
                videoUrl,
                '-x',                          // Extract audio
                '--audio-format', 'mp3',       // Auto-convert to mp3
                '--audio-quality', '0',        // Best quality
                '-o', outputPath,
                '--max-filesize', '200M',      // Safety cap for 3GB data limit
                '--force-ipv4',
                '--no-warnings',
                ...downloadPlatformArgs,
                ...proxyArgs
            ];

            await this.spawnYtDlp(downloadArgs);

            // Find downloaded file
            const files = await fsPromises.readdir('./');
            const audioFile = files.find(x => 
                x.startsWith(filePrefix) && x.endsWith('.mp3')
            );

            if (!audioFile) {
                // Check if file was too large
                const anyFile = files.find(x => x.startsWith(filePrefix));
                if (!anyFile) {
                    throw new Error('Downloaded file not found. The file might be too large (>200MB). Try a shorter song! 📦');
                }
                throw new Error('Audio conversion failed');
            }

            // Check file size before sending
            const stats = await fsPromises.stat(audioFile);
            if (stats.size > 200 * 1024 * 1024) { // 200MB
                await cleanupFiles(filePrefix);
                return await this.reply(sock, from, msg, '📦 Waduh, filenya kegedean bro (>200MB)! Coba lagu yang lebih pendek ya 😅');
            }

            // Send audio
            const audioBuffer = await fsPromises.readFile(audioFile);
            await sock.sendMessage(from, {
                audio: audioBuffer,
                mimetype: 'audio/mpeg'
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            // Friendly error messages
            let errorMsg = '❌ Gagal download musik.';
            if (error.message.includes('too large') || error.message.includes('>200MB')) {
                errorMsg = '📦 Waduh, filenya kegedean bro (>200MB)! Coba lagu yang lebih pendek ya 😅';
            } else if (error.message.includes('Sign in') || error.message.includes('bot')) {
                errorMsg = '⚠️ YouTube sedang blocking. Coba lagi nanti atau hubungi admin.';
            } else if (error.message.includes('No video')) {
                errorMsg = '❌ Lagu tidak ditemukan. Coba kata kunci lain.';
            } else if (error.message.includes('timeout') || error.message.includes('TransportError')) {
                errorMsg = '⏱️ Koneksi ke YouTube timeout. Coba lagi nanti!';
            } else if (error.message.includes('Unable to download') || error.message.includes('Connection refused')) {
                errorMsg = '🌐 Koneksi gagal. Coba lagi nanti!';
            }
            
            await this.reply(sock, from, msg, errorMsg);
        } finally {
            // Cleanup temporary files immediately
            await cleanupFiles(filePrefix);
        }
    }
}

module.exports = MusicCommand;
