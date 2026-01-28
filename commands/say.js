/**
 * Say (TTS) Command
 * Text-to-Speech menggunakan ElevenLabs API v3 alpha
 * Mendukung tag bahasa dan ekspresi
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const config = require('../config');

class SayCommand extends CommandBase {
    constructor() {
        super({
            name: 'say',
            aliases: ['tts', 'speak', 'bicara'],
            description: 'Mengubah teks menjadi suara menggunakan AI',
            usage: '.say <teks> atau .say <en> <teks> atau .say [berteriak] <teks>',
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
     * @param {string[]} args - Argumen command
     * @returns {Object} - { language, text, expressions }
     */
    parseInput(args) {
        if (!args || args.length === 0) {
            return { language: 'id', text: '', expressions: [] };
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

        // Ekstrak ekspresi tags seperti [screaming], [whispering], dll
        const expressionPattern = /\[(.*?)\]/g;
        const expressions = [];
        let match;
        while ((match = expressionPattern.exec(textWithoutLang)) !== null) {
            expressions.push(match[1]);
        }

        // Teks final (biarkan expression tags di dalam teks untuk ElevenLabs)
        const text = textWithoutLang.trim();

        return { language, text, expressions };
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
                '• `.say [berteriak] tolong!` - Dengan ekspresi\n' +
                '• `.say <en> [whispering] be quiet` - Kombinasi\n\n' +
                '🌐 *Tag Bahasa:*\n' +
                '`<id>` Indonesia (default)\n' +
                '`<en>` English\n' +
                '`<es>` Español\n' +
                '`<ja>` 日本語\n' +
                '`<ko>` 한국어\n' +
                '`<zh>` 中文\n\n' +
                '🎭 *Tag Ekspresi:*\n' +
                '`[berteriak]` `[berbisik]` `[marah]`\n' +
                '`[screaming]` `[whispering]` `[laughing]`');
        }

        // Batas karakter
        if (text.length > 500) {
            return await this.reply(sock, from, msg, 
                '❌ Teks terlalu panjang!\n\nMaksimal 500 karakter.');
        }

        await this.react(sock, msg, '🎤');

        try {
            // Panggil ElevenLabs API
            const audioBuffer = await this.generateSpeech(text, language);

            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Audio kosong dari API');
            }

            // Kirim sebagai voice note (ptt = push to talk)
            await sock.sendMessage(from, {
                audio: audioBuffer,
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
        }
    }

    /**
     * Generate speech using ElevenLabs API v3 alpha
     * @param {string} text - Text to convert
     * @param {string} language - Language code
     * @returns {Buffer} - Audio buffer
     */
    async generateSpeech(text, language) {
        const voiceId = config.apis.elevenlabs.voiceId;
        const apiKey = config.apis.elevenlabs.key;

        // ElevenLabs API v3 alpha endpoint
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

        const settings = this.languageSettings[language] || this.languageSettings['id'];

        const requestBody = {
            text: text,
            model_id: 'eleven_v3', // Model v3 alpha
            voice_settings: {
                stability: settings.stability,
                similarity_boost: settings.similarity_boost,
                style: 0.5,
                use_speaker_boost: true
            }
        };

        // Add language hint for better pronunciation
        if (language && language !== 'en') {
            requestBody.language_code = language;
        }

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
