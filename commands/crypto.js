/**
 * Crypto Price Command
 * Get cryptocurrency prices
 */

const CommandBase = require('./base');
const axios = require('axios');
const cache = require('../utils/cache');

class CryptoCommand extends CommandBase {
    constructor() {
        super({
            name: 'crypto',
            aliases: ['coin', 'bitcoin', 'btc'],
            description: 'Get cryptocurrency price information',
            usage: '.crypto [symbol]',
            category: 'info',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        const symbol = args[0]?.toLowerCase() || 'bitcoin';
        const cacheKey = `crypto:${symbol}`;

        // Check cache (5 minute)
        const cached = cache.get(cacheKey);
        if (cached) {
            return await this.sendCryptoInfo(sock, from, msg, cached, true);
        }

        await this.react(sock, msg, '💰');

        try {
            // Using CoinGecko API (free, no key required)
            const { data } = await axios.get(
                `https://api.coingecko.com/api/v3/coins/${symbol}`,
                { timeout: 10000 }
            );

            // Cache for 5 minutes
            cache.set(cacheKey, data, 300000);

            await this.sendCryptoInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            
            if (error.response?.status === 404) {
                await this.reply(sock, from, msg, 
                    `❌ Cryptocurrency "${symbol}" not found.\n\nTry: bitcoin, ethereum, dogecoin, etc.`);
            } else {
                await this.reply(sock, from, msg, '❌ Failed to fetch crypto data.');
            }
        }
    }

    async sendCryptoInfo(sock, from, msg, data, fromCache) {
        try {
            const name = data.name;
            const symbol = data.symbol.toUpperCase();
            const price = data.market_data.current_price.usd;
            const change24h = data.market_data.price_change_percentage_24h;
            const change7d = data.market_data.price_change_percentage_7d;
            const marketCap = data.market_data.market_cap.usd;
            const volume24h = data.market_data.total_volume.usd;
            const high24h = data.market_data.high_24h.usd;
            const low24h = data.market_data.low_24h.usd;

            const changeEmoji = change24h >= 0 ? '📈' : '📉';
            const changeColor = change24h >= 0 ? '+' : '';

            const info = 
`💰 *${name} (${symbol})*

💵 Price: $${this.formatNumber(price)}
${changeEmoji} 24h: ${changeColor}${change24h.toFixed(2)}%
📊 7d: ${changeColor}${change7d?.toFixed(2) || 'N/A'}%

📈 24h High: $${this.formatNumber(high24h)}
📉 24h Low: $${this.formatNumber(low24h)}

💎 Market Cap: $${this.formatLargeNumber(marketCap)}
📊 Volume (24h): $${this.formatLargeNumber(volume24h)}

${fromCache ? '📦 (cached)' : '🔄 Live data'}`;

            const thumbnail = data.image?.large;

            if (thumbnail) {
                await sock.sendMessage(from, {
                    image: { url: thumbnail },
                    caption: info
                }, { quoted: msg });
            } else {
                await this.reply(sock, from, msg, info);
            }

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, { context: 'send-crypto-info' });
            throw error;
        }
    }

    formatNumber(num) {
        if (num >= 1) {
            return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
        return num.toFixed(6);
    }

    formatLargeNumber(num) {
        if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
        if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
        return this.formatNumber(num);
    }
}

module.exports = CryptoCommand;
