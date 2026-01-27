/**
 * Music Command
 * Search and download music from YouTube
 * Uses python3 -m yt_dlp with proxy and android client strategy
 */

const CommandBase = require('./base');
const { spawn } = require('child_process');
const { generateFilename, cleanupFiles } = require('../utils/helpers');
const fsPromises = require('fs').promises;
const config = require('../config');

class MusicCommand extends CommandBase {
    constructor() {
        super({
            name: 'music',
            aliases: ['song', 'mp3', 'audio'],
            description: 'Search and download music from YouTube',
            usage: '.music <song name>',
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
            return await this.reply(sock, from, msg, '🎵 What song do you want?\n\nExample: .music About You The 1975');
        }

        await this.react(sock, msg, '🔍');

        const query = args.join(' ');
        const filePrefix = generateFilename('music', '');
        
        // Build proxy args from config - uses getYtDlpProxyArgs method
        const proxyArgs = config.getYtDlpProxyArgs();

        try {
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
                return await this.reply(sock, from, msg, '❌ Song is too long or not found. Try a different song.');
            }

            // Step 2: Download audio using "Let it Be" method
            // Let yt-dlp download whatever stream is best, then convert to mp3
            const outputPath = `${filePrefix}.%(ext)s`;
            const downloadArgs = [
                `https://youtu.be/${validVideo.id}`,
                '-x',                          // Extract audio
                '--audio-format', 'mp3',       // Auto-convert to mp3
                '--audio-quality', '0',        // Best quality
                '-o', outputPath,
                '--max-filesize', '200M',      // Safety cap for 3GB data limit
                '--extractor-args', 'youtube:player_client=android',
                '--force-ipv4',
                '--no-warnings',
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
                mimetype: 'audio/mp4',
                caption: `🎵 ${validVideo.title}`
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            // Friendly error messages
            let errorMsg = '❌ Failed to download music.';
            if (error.message.includes('too large') || error.message.includes('>200MB')) {
                errorMsg = '📦 Waduh, filenya kegedean bro (>200MB)! Coba lagu yang lebih pendek ya 😅';
            } else if (error.message.includes('Sign in') || error.message.includes('bot')) {
                errorMsg = '⚠️ YouTube blocking detected. Please try again later or contact admin.';
            } else if (error.message.includes('No video')) {
                errorMsg = '❌ Song not found. Try a different search term.';
            }
            
            await this.reply(sock, from, msg, errorMsg);
        } finally {
            // Cleanup temporary files immediately
            await cleanupFiles(filePrefix);
        }
    }
}

module.exports = MusicCommand;
