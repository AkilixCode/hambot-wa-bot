/**
 * Calculator Command
 * Evaluate mathematical expressions with a self-contained parser
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

// Functions callable from an expression, e.g. sqrt(16).
const FUNCTIONS = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    log: Math.log10,
    ln: Math.log,
    exp: Math.exp
};

const CONSTANTS = {
    pi: Math.PI,
    e: Math.E
};

class CalcCommand extends CommandBase {
    constructor() {
        super({
            name: 'calc',
            aliases: ['calculate', 'math'],
            description: 'Hitung ekspresi matematika',
            usage: '.calc <ekspresi>',
            category: 'utility',
            cooldown: 2000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🧮',
                title: 'Kalkulator',
                description: 'Hitung ekspresi matematika langsung dari chat.',
                usage: ['.calc <ekspresi>'],
                examples: [
                    '.calc 5 + 3',
                    '.calc 10 * 2.5',
                    '.calc sqrt(16)',
                    '.calc 2^8',
                    '.calc (100 - 40) / 3'
                ],
                notes: [
                    'Operator: + - * / % ^',
                    'Fungsi: sqrt, abs, round, floor, ceil, sin, cos, tan, log, ln, exp',
                    'Konstanta: pi, e'
                ]
            });
        }

        await this.react(sock, msg, '🧮');

        const expression = args.join(' ');

        try {
            const result = this.evaluate(expression);

            await this.reply(sock, from, msg, ui.card({
                icon: '🧮',
                title: 'Kalkulator',
                lines: [
                    ui.kv('Ekspresi', ui.mono(ui.safe(expression, 200)), '📝'),
                    ui.kv('Hasil', ui.bold(ui.number(result)), '✅')
                ]
            }));
            await this.react(sock, msg, '✅');

        } catch (error) {
            await this.replyError(sock, from, msg,
                'Ekspresi tidak bisa dihitung — periksa lagi penulisannya.', {
                    title: 'Ekspresi Salah',
                    hint: ['.calc 5 + 3', '.calc sqrt(16)', '.calc 2^8']
                });
        }
    }

    /**
     * Evaluate a mathematical expression.
     *
     * The previous implementation pasted the expression into a string and ran
     * it through Function(), relying on a character whitelist to stay safe. A
     * parser removes the eval primitive entirely. It also fixes ceil(), which
     * the old chain of .replace() calls silently corrupted into
     * `Math.cMath.Eil(` once it rewrote every lowercase "e" into Math.E.
     *
     * @param {string} input
     * @returns {number}
     * @throws {Error} When the expression is malformed or the result is not finite
     */
    evaluate(input) {
        const tokens = this._tokenize(input);
        if (tokens.length === 0) throw new Error('Empty expression');

        const state = { tokens, pos: 0 };
        const value = this._parseExpression(state);

        if (state.pos < tokens.length) {
            throw new Error('Unexpected trailing input');
        }
        if (typeof value !== 'number' || !isFinite(value)) {
            throw new Error('Result is not a finite number');
        }

        // Trim floating-point noise: 0.1 + 0.2 should read as 0.3.
        return Math.round(value * 1e10) / 1e10;
    }

    /**
     * @param {string} input
     * @returns {Array<{type: string, value: (number|string)}>}
     * @private
     */
    _tokenize(input) {
        // Accept the typographic operators people paste in from elsewhere, and
        // ignore thousands separators.
        const src = String(input).replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '');
        const tokens = [];
        let i = 0;

        while (i < src.length) {
            const ch = src[i];

            if (ch === ' ' || ch === '\t') { i++; continue; }

            if (/[0-9.]/.test(ch)) {
                let num = '';
                while (i < src.length && /[0-9.]/.test(src[i])) num += src[i++];
                if (!/^\d*\.?\d+$/.test(num)) throw new Error(`Malformed number: ${num}`);
                tokens.push({ type: 'number', value: parseFloat(num) });
                continue;
            }

            if (/[a-z]/i.test(ch)) {
                let name = '';
                while (i < src.length && /[a-z]/i.test(src[i])) name += src[i++];
                tokens.push({ type: 'name', value: name.toLowerCase() });
                continue;
            }

            if ('+-*/%^()'.includes(ch)) {
                tokens.push({ type: 'operator', value: ch });
                i++;
                continue;
            }

            throw new Error(`Unsupported character: ${ch}`);
        }

        return tokens;
    }

    /** @private */
    _peek(state) {
        return state.tokens[state.pos];
    }

    /** @private */
    _eat(state, value) {
        const token = this._peek(state);
        if (token && token.type === 'operator' && token.value === value) {
            state.pos++;
            return true;
        }
        return false;
    }

    /** expression := term (('+' | '-') term)* @private */
    _parseExpression(state) {
        let left = this._parseTerm(state);

        for (;;) {
            if (this._eat(state, '+')) left += this._parseTerm(state);
            else if (this._eat(state, '-')) left -= this._parseTerm(state);
            else return left;
        }
    }

    /** term := unary (('*' | '/' | '%') unary)* @private */
    _parseTerm(state) {
        let left = this._parseUnary(state);

        for (;;) {
            if (this._eat(state, '*')) {
                left *= this._parseUnary(state);
            } else if (this._eat(state, '/')) {
                const divisor = this._parseUnary(state);
                if (divisor === 0) throw new Error('Division by zero');
                left /= divisor;
            } else if (this._eat(state, '%')) {
                const divisor = this._parseUnary(state);
                if (divisor === 0) throw new Error('Modulo by zero');
                left %= divisor;
            } else {
                return left;
            }
        }
    }

    /** unary := ('-' | '+') unary | power @private */
    _parseUnary(state) {
        if (this._eat(state, '-')) return -this._parseUnary(state);
        if (this._eat(state, '+')) return this._parseUnary(state);
        return this._parsePower(state);
    }

    /** power := primary ('^' unary)?  — right associative, so 2^3^2 is 512 @private */
    _parsePower(state) {
        const base = this._parsePrimary(state);
        if (this._eat(state, '^')) {
            return Math.pow(base, this._parseUnary(state));
        }
        return base;
    }

    /** primary := number | constant | function '(' expression ')' | '(' expression ')' @private */
    _parsePrimary(state) {
        const token = this._peek(state);
        if (!token) throw new Error('Unexpected end of expression');

        if (token.type === 'number') {
            state.pos++;
            return token.value;
        }

        if (token.type === 'name') {
            state.pos++;

            if (Object.prototype.hasOwnProperty.call(FUNCTIONS, token.value)) {
                if (!this._eat(state, '(')) throw new Error(`Expected ( after ${token.value}`);
                const argument = this._parseExpression(state);
                if (!this._eat(state, ')')) throw new Error('Missing closing parenthesis');
                return FUNCTIONS[token.value](argument);
            }

            if (Object.prototype.hasOwnProperty.call(CONSTANTS, token.value)) {
                return CONSTANTS[token.value];
            }

            throw new Error(`Unknown name: ${token.value}`);
        }

        if (this._eat(state, '(')) {
            const value = this._parseExpression(state);
            if (!this._eat(state, ')')) throw new Error('Missing closing parenthesis');
            return value;
        }

        throw new Error(`Unexpected token: ${token.value}`);
    }
}

module.exports = CalcCommand;
