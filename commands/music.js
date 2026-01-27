/**
 * Music Command
 * Search and download music from YouTube
 */

const CommandBase = require('./base');
const { spawnPromise, generateFilename, cleanupFiles } = require('../utils/helpers');
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

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, '🎵 What song do you want?\n\nExample: .music About You The 1975');
        }

        await this.react(sock, msg, '🔍');

        const query = args.join(' ');
        const filePrefix = generateFilename('music', '');
        const proxyArgs = config.media.proxyUrl ? ['--proxy', config.media.proxyUrl] : [];

        try {
            // Step 1: Search for videos and check duration
            await this.react(sock, msg, '🎵');

            const searchArgs = [
                `ytsearch5:${query}`,
                '--dump-json',
                '--no-playlist',
                '--flat-playlist',
                ...proxyArgs
            ];

            const searchResult = await spawnPromise('yt-dlp', searchArgs);

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

            // Step 2: Download audio
            const outputPath = `${filePrefix}.%(ext)s`;
            const downloadArgs = [
                `https://youtu.be/${validVideo.id}`,
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '0',
                '-o', outputPath,
                '--max-filesize', config.media.maxFileSize,
                ...proxyArgs,
                '--extractor-args', 'youtube:player_client=android',
                '--force-ipv4',
                '--no-warnings'
            ];

            await spawnPromise('yt-dlp', downloadArgs);

            // Find downloaded file
            const files = await fsPromises.readdir('./');
            const audioFile = files.find(x => 
                x.startsWith(filePrefix) && x.endsWith('.mp3')
            );

            if (!audioFile) {
                throw new Error('Downloaded file not found');
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
            await this.reply(sock, from, msg, `❌ Failed to download music. ${error.message}`);
        } finally {
            // Cleanup temporary files
            await cleanupFiles(filePrefix);
        }
    }
}

module.exports = MusicCommand;
