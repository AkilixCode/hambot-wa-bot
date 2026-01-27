/**
 * Calculator Command
 * Evaluate mathematical expressions safely
 */

const CommandBase = require('./base');

class CalcCommand extends CommandBase {
    constructor() {
        super({
            name: 'calc',
            aliases: ['calculate', 'math'],
            description: 'Calculate mathematical expressions',
            usage: '.calc <expression>',
            category: 'utility',
            cooldown: 2000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '🧮 *Calculator*\n\nUsage: .calc <expression>\n\nExamples:\n• .calc 5 + 3\n• .calc 10 * 2.5\n• .calc sqrt(16)\n• .calc 2^8');
        }

        await this.react(sock, msg, '🧮');

        try {
            const expression = args.join(' ');
            const result = this.safeEval(expression);

            const response = 
`🧮 *Calculator*

📝 Expression: \`${expression}\`
✅ Result: **${result}**`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Invalid expression. Please check your syntax.');
        }
    }

    safeEval(expression) {
        // Replace common math symbols
        let expr = expression
            .replace(/\^/g, '**')
            .replace(/×/g, '*')
            .replace(/÷/g, '/')
            .replace(/sqrt\(/g, 'Math.sqrt(')
            .replace(/sin\(/g, 'Math.sin(')
            .replace(/cos\(/g, 'Math.cos(')
            .replace(/tan\(/g, 'Math.tan(')
            .replace(/log\(/g, 'Math.log(')
            .replace(/abs\(/g, 'Math.abs(')
            .replace(/round\(/g, 'Math.round(')
            .replace(/floor\(/g, 'Math.floor(')
            .replace(/ceil\(/g, 'Math.ceil(')
            .replace(/pi/gi, 'Math.PI')
            .replace(/e/g, 'Math.E');

        // Only allow numbers, operators, Math functions, and parentheses
        if (!/^[0-9+\-*/.() ,MathsqrtSincostanlogabsroundfloorcepiPIE]+$/.test(expr)) {
            throw new Error('Invalid characters in expression');
        }

        // Evaluate safely
        const result = Function('"use strict"; return (' + expr + ')')();
        
        if (typeof result !== 'number' || !isFinite(result)) {
            throw new Error('Invalid result');
        }

        // Round to 10 decimal places
        return Math.round(result * 10000000000) / 10000000000;
    }
}

module.exports = CalcCommand;
