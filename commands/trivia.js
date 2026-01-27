/**
 * Trivia Command
 * Play trivia quiz game
 */

const CommandBase = require('./base');
const axios = require('axios');

class TriviaCommand extends CommandBase {
    constructor() {
        super({
            name: 'trivia',
            aliases: ['quiz', 'question'],
            description: 'Get a random trivia question',
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
            // Using Open Trivia Database
            const { data } = await axios.get(
                `https://opentdb.com/api.php?amount=1&difficulty=${selectedDifficulty}&type=multiple`,
                { timeout: 10000 }
            );

            if (data.results && data.results.length > 0) {
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

                const response = 
`🎯 *Trivia Quiz*

${difficultyEmoji} Difficulty: ${selectedDifficulty.toUpperCase()}
📚 Category: ${question.category}

❓ Question:
${decodedQuestion}

Options:
${answerList}

_Answer will be revealed in replies!_`;

                await this.reply(sock, from, msg, response);
                
                // Send answer after a delay (in a follow-up message)
                setTimeout(async () => {
                    const answerResponse = `✅ *Answer:* ${correctAnswer}`;
                    await this.reply(sock, from, msg, answerResponse);
                }, 5000);

                await this.react(sock, msg, '✅');

            } else {
                throw new Error('No trivia question received');
            }

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to fetch trivia question. Try again!');
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
