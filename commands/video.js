/**
 * Video Command
 * Download videos from various platforms (TikTok, Instagram, Facebook, YouTube, etc.)
 */

const CommandBase = require('./base');
const { spawn } = require('child_process');
const { generateFilename, cleanupFiles } = require('../utils/helpers');
const fsPromises = require('fs').promises;
const config = require('../config');

// Video format selector: prefer mp4, fallback to best available
const VIDEO_FORMAT_SELECTOR = 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';

class VideoCommand extends CommandBase {
    constructor() {
        super({
            name: 'video',
            aliases: ['vid', 'dl', 'download'],
            description: 'Download video dari berbagai platform',
            usage: '.video <url>',
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

        if (!args[0]) {
            return await this.reply(sock, from, msg, '📹 Kirim URL video!\n\nContoh: .video https://www.tiktok.com/@user/video/...\n\nSupport: TikTok, Instagram, Facebook, YouTube, dll');
        }

        // Validate URL
        const url = args[0];
        if (!/^https?:\/\//i.test(url)) {
            return await this.reply(sock, from, msg, '❌ URL tidak valid! Harus dimulai dengan http:// atau https://');
        }

        await this.react(sock, msg, '⏳');

        const filePrefix = generateFilename('video', '');
        
        // Build proxy args from config - uses getYtDlpProxyArgs method
        const proxyArgs = config.getYtDlpProxyArgs();

        try {
            // Get video information first
            await this.react(sock, msg, '📹');
            
            const infoArgs = [
                url,
                '--dump-json',
                '--no-playlist',
                '--extractor-args', 'youtube:player_client=android',
                '--force-ipv4',
                ...proxyArgs
            ];

            let videoTitle = 'Video';
            let videoDuration = 0;

            try {
                const infoResult = await this.spawnYtDlp(infoArgs);
                const videoInfo = JSON.parse(infoResult.trim().split('\n')[0]);
                
                videoTitle = videoInfo.title || 'Video';
                videoDuration = videoInfo.duration || 0;
                
                // Check duration limit
                if (videoDuration > config.media.maxDuration) {
                    return await this.reply(sock, from, msg, '❌ Video terlalu panjang. Coba video yang lebih pendek ya!');
                }
            } catch (infoError) {
                // If info extraction fails, continue with download anyway
                this.logError(infoError, context);
            }

            // Download video with highest quality available
            // yt-dlp will automatically select the best format
            const outputPath = `${filePrefix}.%(ext)s`;
            const downloadArgs = [
                url,
                '-f', VIDEO_FORMAT_SELECTOR,
                '--merge-output-format', 'mp4',  // Ensure output is mp4
                '-o', outputPath,
                '--max-filesize', '200M',        // Safety cap for 3GB data limit
                '--extractor-args', 'youtube:player_client=android',
                '--force-ipv4',
                '--no-warnings',
                ...proxyArgs
            ];

            await this.spawnYtDlp(downloadArgs);

            // Find downloaded file
            const files = await fsPromises.readdir('./');
            const videoFile = files.find(x => 
                x.startsWith(filePrefix) && (x.endsWith('.mp4') || x.endsWith('.mkv') || x.endsWith('.webm'))
            );

            if (!videoFile) {
                // Check if file was too large
                const anyFile = files.find(x => x.startsWith(filePrefix));
                if (!anyFile) {
                    throw new Error('File too large or download failed');
                }
                throw new Error('Video download failed');
            }

            // Check file size before sending
            const stats = await fsPromises.stat(videoFile);
            if (stats.size > 200 * 1024 * 1024) { // 200MB
                await cleanupFiles(filePrefix);
                return await this.reply(sock, from, msg, '📦 Waduh, filenya kegedean bro (>200MB)! Coba video yang lebih pendek ya 😅');
            }

            // Send video
            const videoBuffer = await fsPromises.readFile(videoFile);
            await sock.sendMessage(from, {
                video: videoBuffer,
                mimetype: 'video/mp4',
                caption: `📹 ${videoTitle}`
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            // Friendly error messages
            let errorMsg = '❌ Gagal download video.';
            if (error.message.includes('too large') || error.message.includes('>200MB')) {
                errorMsg = '📦 Waduh, filenya kegedean bro (>200MB)! Coba video yang lebih pendek ya 😅';
            } else if (error.message.includes('Unsupported URL') || error.message.includes('not supported')) {
                errorMsg = '❌ URL tidak didukung. Coba platform lain.';
            } else if (error.message.includes('Private') || error.message.includes('restricted')) {
                errorMsg = '🔒 Video ini private atau restricted.';
            } else if (error.message.includes('Not available') || error.message.includes('removed')) {
                errorMsg = '❌ Video tidak tersedia atau sudah dihapus.';
            }
            
            await this.reply(sock, from, msg, errorMsg);
        } finally {
            // Cleanup temporary files immediately
            await cleanupFiles(filePrefix);
        }
    }
}

module.exports = VideoCommand;
