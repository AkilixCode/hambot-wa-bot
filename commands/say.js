/**
 * Say (TTS) Command
 * Text-to-Speech menggunakan ElevenLabs API dengan model eleven_multilingual_v2
 * Mendukung tag bahasa (expression tags tidak didukung di model free tier)
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const config = require('../config');
const { spawn } = require('child_process');
const { generateFilename, cleanupFiles } = require('../utils/helpers');
const fsPromises = require('fs').promises;

class SayCommand extends CommandBase {
    constructor() {
        super({
            name: 'say',
            aliases: ['tts', 'speak', 'bicara'],
            description: 'Mengubah teks menjadi suara menggunakan AI',
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
            return await this.reply(sock, from, msg, 
                '❌ API ElevenLabs belum dikonfigurasi!\n\n' +
                'Hubungi admin untuk mengaktifkan fitur TTS.');
        }

        // Parse input
        const { language, text, expressions } = this.parseInput(args);

        if (!text) {
            return await this.reply(sock, from, msg, 
                '🎤 *Perintah Say (Text-to-Speech)*\n\n' +
                '📝 *Cara Pakai:*\n' +
                '• `.say halo semuanya` - Bicara dalam Bahasa Indonesia\n' +
                '• `.say <en> hello everyone` - Bicara dalam Bahasa Inggris\n' +
                '• `.say <ja> こんにちは` - Bicara dalam Bahasa Jepang\n\n' +
                '🌐 *Tag Bahasa:*\n' +
                '`<id>` Indonesia (default)\n' +
                '`<en>` English\n' +
                '`<es>` Español\n' +
                '`<ja>` 日本語\n' +
                '`<ko>` 한국어\n' +
                '`<zh>` 中文\n' +
                '`<fr>` Français\n' +
                '`<de>` Deutsch\n' +
                '`<pt>` Português\n' +
                '`<ru>` Русский\n' +
                '`<ar>` العربية\n' +
                '`<hi>` हिन्दी\n\n' +
                '📋 *Catatan:*\n' +
                '• Maksimal 500 karakter\n' +
                '• Output sebagai voice note WhatsApp');
        }

        // Batas karakter
        if (text.length > 500) {
            return await this.reply(sock, from, msg, 
                '❌ Teks terlalu panjang!\n\nMaksimal 500 karakter.');
        }

        await this.react(sock, msg, '🎤');

        const filePrefix = generateFilename('tts', '');

        try {
            // Panggil ElevenLabs API
            const audioBuffer = await this.generateSpeech(text, language);

            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Audio kosong dari API');
            }

            // Convert MP3 to OGG Opus for WhatsApp voice note compatibility
            const mp3Path = `${filePrefix}.mp3`;
            const oggPath = `${filePrefix}.ogg`;
            
            // Write MP3 to file
            await fsPromises.writeFile(mp3Path, audioBuffer);
            
            // Convert to OGG Opus using ffmpeg
            await this.convertToOggOpus(mp3Path, oggPath);
            
            // Read converted file
            const oggBuffer = await fsPromises.readFile(oggPath);

            // Kirim sebagai voice note (ptt = push to talk)
            // Using OGG Opus format for proper WhatsApp voice note playback
            await sock.sendMessage(from, {
                audio: oggBuffer,
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true // Ini yang membuat jadi voice note
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            let errorMsg = '❌ Gagal menghasilkan suara.';
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                errorMsg = '❌ API key ElevenLabs tidak valid!';
            } else if (error.message.includes('429') || error.message.includes('quota')) {
                errorMsg = '❌ Kuota API ElevenLabs habis. Coba lagi nanti!';
            } else if (error.message.includes('timeout')) {
                errorMsg = '❌ Server ElevenLabs tidak merespon. Coba lagi!';
            }
            
            await this.reply(sock, from, msg, errorMsg);
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
    convertToOggOpus(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            const proc = spawn('ffmpeg', [
                '-i', inputPath,
                '-c:a', 'libopus',
                '-b:a', '64k',
                '-vbr', 'on',
                '-compression_level', '10',
                '-y',
                outputPath
            ]);
            
            let stderr = '';
            proc.stderr.on('data', (data) => stderr += data);
            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg failed: ${stderr}`));
            });
            proc.on('error', (err) => reject(err));
        });
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
