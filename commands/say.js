/**
 * Say (TTS) Command
 * Text-to-Speech menggunakan ElevenLabs API dengan model eleven_multilingual_v2
 * Mendukung tag bahasa (expression tags tidak didukung di model free tier)
 */

const CommandBase = require('./base');
const logger = require('../utils/logger');
const httpClient = require('../utils/http-client');
const config = require('../config');
const { generateFilename, cleanupFiles, spawnPromise } = require('../utils/helpers');
const tempdir = require('../utils/tempdir');
const fsPromises = require('fs').promises;

// A 500-character clip is seconds of audio; anything longer means a stuck
// ffmpeg, which on a heavy command would hold a concurrency slot indefinitely.
const FFMPEG_TIMEOUT_MS = 60000;

class SayCommand extends CommandBase {
    constructor() {
        super({
            name: 'say',
            aliases: ['tts', 'speak', 'bicara'],
            description: 'Ubah teks jadi suara dengan AI',
            usage: '.say <teks> atau .say <en> <teks>',
            category: 'media',
            cooldown: 5000,
            isHeavy: true
        });

        // Mapping bahasa ke voice settings
        this.languageSettings = {
            'en': { stability: 0.5, similarity_boost: 0.75 },
            'id': { stability: 0.5, similarity_boost: 0.75 },
            'es': { stability: 0.5, similarity_boost: 0.75 },
            'fr': { stability: 0.5, similarity_boost: 0.75 },
            'de': { stability: 0.5, similarity_boost: 0.75 },
            'ja': { stability: 0.5, similarity_boost: 0.75 },
            'ko': { stability: 0.5, similarity_boost: 0.75 },
            'zh': { stability: 0.5, similarity_boost: 0.75 },
            'pt': { stability: 0.5, similarity_boost: 0.75 },
            'ru': { stability: 0.5, similarity_boost: 0.75 },
            'ar': { stability: 0.5, similarity_boost: 0.75 },
            'hi': { stability: 0.5, similarity_boost: 0.75 }
        };
    }

    /**
     * Parse input untuk mendapatkan bahasa dan teks
     * Expression tags removed as they are not supported in free tier models
     * @param {string[]} args - Argumen command
     * @returns {Object} - { language, text }
     */
    parseInput(args) {
        if (!args || args.length === 0) {
            return { language: 'id', text: '' };
        }

        const fullText = args.join(' ');
        
        // Cek apakah ada tag bahasa di awal: <en>, <id>, dll
        const langTagMatch = fullText.match(/^<([a-z]{2})>\s*/i);
        let language = 'id'; // Default bahasa Indonesia
        let textWithoutLang = fullText;
        
        if (langTagMatch) {
            const detectedLang = langTagMatch[1].toLowerCase();
            if (this.languageSettings[detectedLang]) {
                language = detectedLang;
                textWithoutLang = fullText.slice(langTagMatch[0].length);
            }
        }

        // Remove expression tags [xxx] as they are not supported in free tier
        // This prevents users from trying to use unsupported features
        const text = textWithoutLang.replace(/\[.*?\]/g, '').trim();

        return { language, text };
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        // Cek API key
        if (!config.apis.elevenlabs.key) {
            return await this.replyError(sock, from, msg,
                'Fitur suara belum diaktifkan di server ini.', {
                    title: 'Belum Dikonfigurasi',
                    hint: ['Hubungi owner bot untuk mengaktifkannya']
                });
        }

        // Parse input
        const { language, text, expressions } = this.parseInput(args);

        if (!text) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🎤',
                title: 'Say (Text-to-Speech)',
                description: 'Ubah teks jadi voice note.',
                usage: ['.say <teks>', '.say <kode bahasa> <teks>'],
                examples: [
                    '.say halo semuanya',
                    '.say <en> hello everyone',
                    '.say <ja> こんにちは'
                ],
                notes: [
                    'Bahasa: id (default), en, es, ja, ko, zh, fr, de, pt, ru, ar, hi',
                    'Maksimal 500 karakter',
                    'Hasilnya dikirim sebagai voice note'
                ]
            });
        }

        // Batas karakter
        if (text.length > 500) {
            return await this.replyError(sock, from, msg,
                `Teksnya kepanjangan (${text.length} karakter).`, {
                    title: 'Terlalu Panjang',
                    hint: ['Maksimal 500 karakter']
                });
        }

        await this.react(sock, msg, '🎤');

        const filePrefix = generateFilename('tts', '');

        try {
            // Panggil ElevenLabs API
            logger.info(`Say: generating TTS audio for language=${language}, text length=${text.length}`);
            const audioBuffer = await this.generateSpeech(text, language);

            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Audio kosong dari API');
            }

            // Convert MP3 to OGG Opus for WhatsApp voice note compatibility.
            // Scratch files go to tmp/, not the repo root.
            const mp3Path = tempdir.tempPath(`${filePrefix}.mp3`);
            const oggPath = tempdir.tempPath(`${filePrefix}.ogg`);
            
            // Write MP3 to file
            await fsPromises.writeFile(mp3Path, audioBuffer);
            
            // Convert to OGG Opus using ffmpeg
            await this.convertToOggOpus(mp3Path, oggPath);
            
            // Read converted file
            const oggBuffer = await fsPromises.readFile(oggPath);
            logger.info(`Say: audio generated, size=${(oggBuffer.length / 1024).toFixed(1)}KB`);

            // Kirim sebagai voice note (ptt = push to talk)
            // Using OGG Opus format for proper WhatsApp voice note playback
            await this.replyMedia(sock, from, msg, {
                audio: oggBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true // Ini yang membuat jadi voice note
            });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);

            const m = error.message || '';
            let reason = 'Gagal menghasilkan suara.';
            let title = 'Gagal';
            let hint = ['Coba lagi sebentar lagi'];

            if (m.includes('401') || m.includes('Unauthorized')) {
                title = 'API Key Bermasalah';
                reason = 'API key ElevenLabs tidak valid.';
                hint = ['Hubungi owner bot'];
            } else if (m.includes('429') || m.includes('quota')) {
                title = 'Kuota Habis';
                reason = 'Kuota ElevenLabs sudah habis.';
                hint = ['Coba lagi bulan depan', 'Hubungi owner bot'];
            } else if (m.includes('timeout')) {
                title = 'Waktu Habis';
                reason = 'Server ElevenLabs tidak merespons.';
            }

            await this.replyError(sock, from, msg, reason, { title, hint });
        } finally {
            // Cleanup temporary files
            await cleanupFiles(filePrefix);
        }
    }

    /**
     * Convert MP3 to OGG Opus format for WhatsApp voice notes
     * @param {string} inputPath - Input MP3 file path
     * @param {string} outputPath - Output OGG file path
     * @returns {Promise<void>}
     */
    async convertToOggOpus(inputPath, outputPath) {
        // Via spawnPromise for the command allowlist and, more importantly, the
        // timeout. This used to be a bare spawn with no deadline — and .say is
        // a heavy command, so a wedged ffmpeg permanently consumed one of the
        // three concurrent slots.
        await spawnPromise('ffmpeg', [
            '-i', inputPath,
            '-c:a', 'libopus',
            '-b:a', '64k',
            '-vbr', 'on',
            '-compression_level', '10',
            '-y',
            outputPath
        ], { timeout: FFMPEG_TIMEOUT_MS });
    }

    /**
     * Generate speech using ElevenLabs API
     * Uses eleven_multilingual_v2 model which is available for free tier users
     * @param {string} text - Text to convert
     * @param {string} language - Language code
     * @returns {Buffer} - Audio buffer
     */
    async generateSpeech(text, language) {
        const voiceId = config.apis.elevenlabs.voiceId;
        const apiKey = config.apis.elevenlabs.key;

        // ElevenLabs API v1 endpoint
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

        const settings = this.languageSettings[language] || this.languageSettings['id'];

        // Using eleven_multilingual_v2 which is available for free tier
        // eleven_v3 requires paid subscription
        const requestBody = {
            text: text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
                stability: settings.stability,
                similarity_boost: settings.similarity_boost
            }
        };

        const response = await httpClient.post(url, requestBody, {
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': apiKey
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        return Buffer.from(response.data);
    }
}

module.exports = SayCommand;
