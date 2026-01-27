/**
 * AI Chat Command
 * Chat with AI using Google Gemini Free Tier API
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const config = require('../config');

class AICommand extends CommandBase {
    constructor() {
        super({
            name: 'ai',
            aliases: ['tanya', 'ask', 'gemini', 'chat'],
            description: 'Chat with AI (Gemini)',
            usage: '.ai <your question>',
            category: 'ai',
            cooldown: 3000,
            isHeavy: false
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '🤖 *AI Chat*\n\n' +
                'Tanya apa aja ke AI!\n\n' +
                'Contoh:\n' +
                '• .ai Apa itu cryptocurrency?\n' +
                '• .tanya Cara masak mie goreng\n' +
                '• .ask What is the meaning of life?'
            );
        }

        await this.react(sock, msg, '🤔');

        const question = args.join(' ');

        try {
            // Check if Gemini API key is configured
            if (!config.apis.gemini.key) {
                return await this.reply(sock, from, msg, 
                    '⚠️ AI belum dikonfigurasi. Hubungi admin untuk setup API key.'
                );
            }

            const response = await this.askGemini(question);
            
            await this.reply(sock, from, msg, `🤖 *AI Response*\n\n${response}`);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            // Friendly error messages
            let errorMsg = '❌ AI gagal menjawab. Coba lagi nanti ya!';
            if (error.message.includes('quota') || error.message.includes('limit')) {
                errorMsg = '⚠️ Kuota AI habis hari ini. Coba lagi besok ya!';
            } else if (error.message.includes('API key')) {
                errorMsg = '⚠️ API key tidak valid. Hubungi admin.';
            }
            
            await this.reply(sock, from, msg, errorMsg);
        }
    }

    /**
     * Call Google Gemini API
     * Uses HTTP client with proxy support
     */
    async askGemini(question) {
        const apiKey = config.apis.gemini.key;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const response = await httpClient.post(url, {
            contents: [{
                parts: [{
                    text: `You are a friendly and helpful AI assistant for a WhatsApp group of friends. 
Keep your responses concise (max 500 words) and use casual, friendly language. 
You can use emojis sparingly to make responses more engaging.
Respond in the same language as the question.

Question: ${question}`
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 1024,
                topP: 0.95
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        // Extract response text
        const candidates = response.data.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('No response from AI');
        }

        const content = candidates[0].content;
        if (!content || !content.parts || content.parts.length === 0) {
            throw new Error('Empty response from AI');
        }

        return content.parts[0].text;
    }
}

module.exports = AICommand;
