/**
 * Trivia Command
 * Play trivia quiz game
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const logger = require('../utils/logger');
const ui = require('../utils/ui');

// How long people get to think before the answer is revealed.
const ANSWER_DELAY_MS = 15000;

class TriviaCommand extends CommandBase {
    constructor() {
        super({
            name: 'trivia',
            aliases: ['quiz', 'question'],
            description: 'Main kuis trivia acak',
            usage: '.trivia [easy/medium/hard]',
            category: 'fun',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '🎯');

        const difficulty = args[0]?.toLowerCase() || 'medium';
        const validDifficulties = ['easy', 'medium', 'hard'];
        
        const selectedDifficulty = validDifficulties.includes(difficulty) 
            ? difficulty 
            : 'medium';

        try {
            // Using Open Trivia Database with proxy support
            logger.info('Trivia: fetching question...');
            const { data } = await httpClient.get(
                `https://opentdb.com/api.php?amount=1&difficulty=${selectedDifficulty}&type=multiple`,
                { timeout: 10000 }
            );

            if (data.results && data.results.length > 0) {
                logger.info('Trivia: question loaded');
                const question = data.results[0];
                
                // Decode HTML entities
                const decodedQuestion = this.decodeHTML(question.question);
                const correctAnswer = this.decodeHTML(question.correct_answer);
                const incorrectAnswers = question.incorrect_answers.map(a => this.decodeHTML(a));
                
                // Shuffle answers
                const allAnswers = [correctAnswer, ...incorrectAnswers]
                    .sort(() => Math.random() - 0.5);
                
                const answerList = allAnswers
                    .map((ans, idx) => `${idx + 1}. ${ans}`)
                    .join('\n');

                const difficultyEmoji = {
                    easy: '🟢',
                    medium: '🟡',
                    hard: '🔴'
                }[selectedDifficulty];

                const difficultyName = {
                    easy: 'Mudah',
                    medium: 'Sedang',
                    hard: 'Sulit'
                }[selectedDifficulty];

                await this.reply(sock, from, msg, ui.card({
                    icon: '🎯',
                    title: 'Kuis Trivia',
                    lines: [
                        ui.kv('Tingkat', difficultyName, difficultyEmoji),
                        ui.kv('Kategori', question.category, '📚'),
                        '',
                        `❓ ${ui.bold(decodedQuestion)}`,
                        '',
                        answerList
                    ],
                    footer: `Jawaban muncul dalam ${ANSWER_DELAY_MS / 1000} detik`
                }));

                // Reveal the answer separately so people have time to think. The
                // old five-second gap arrived before most had finished reading.
                setTimeout(async () => {
                    try {
                        await this.reply(sock, from, msg, ui.card({
                            icon: '✅',
                            title: 'Jawaban',
                            lines: [ui.bold(correctAnswer)],
                            footer: 'Ketik .trivia untuk soal berikutnya'
                        }));
                    } catch (revealError) {
                        // The chat may be gone by now; a failed reveal must not
                        // crash the process from inside a bare timer callback.
                        this.logError(revealError, context);
                    }
                }, ANSWER_DELAY_MS);

                await this.react(sock, msg, '✅');

            } else {
                throw new Error('No trivia question received');
            }

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal mengambil soal trivia.', {
                hint: ['Coba lagi sebentar lagi', '.trivia easy']
            });
        }
    }

    decodeHTML(text) {
        const entities = {
            '&quot;': '"',
            '&#039;': "'",
            '&amp;': '&',
            '&lt;': '<',
            '&gt;': '>',
            '&rsquo;': "'",
            '&lsquo;': "'",
            '&ldquo;': '"',
            '&rdquo;': '"'
        };
        
        return text.replace(/&[^;]+;/g, match => entities[match] || match);
    }
}

module.exports = TriviaCommand;
