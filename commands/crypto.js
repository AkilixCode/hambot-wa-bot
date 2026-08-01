/**
 * Crypto Price Command
 * Get cryptocurrency prices
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

class CryptoCommand extends CommandBase {
    constructor() {
        super({
            name: 'crypto',
            aliases: ['kripto', 'bitcoin', 'btc'],
            description: 'Cek harga cryptocurrency terkini',
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
            // Using CoinGecko API (free, no key required) with proxy support
            logger.info(`Crypto: fetching data for "${symbol}"`);
            const { data } = await httpClient.get(
                `https://api.coingecko.com/api/v3/coins/${symbol}`,
                { timeout: 10000 }
            );
            logger.info(`Crypto: data received for ${data.name}`);

            // Cache for 5 minutes
            cache.set(cacheKey, data, 300000);

            await this.sendCryptoInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            
            if (error.response?.status === 404) {
                await this.replyError(sock, from, msg,
                    `Koin ${ui.mono(ui.safe(symbol, 30))} tidak ada di CoinGecko.`, {
                        title: 'Koin Tidak Ditemukan',
                        hint: ['.crypto bitcoin', '.crypto ethereum', '.crypto dogecoin']
                    });
            } else {
                await this.replyError(sock, from, msg, 'Gagal mengambil data harga kripto.', {
                    hint: ['Coba lagi sebentar lagi']
                });
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

            const info = ui.card({
                icon: '💰',
                title: `${name} (${symbol})`,
                lines: [
                    ui.kv('Harga', `$${ui.number(price)}`, '💵'),
                    ui.kv('24 jam', `${changeColor}${change24h.toFixed(2)}%`, changeEmoji),
                    ui.kv('7 hari', change7d != null ? `${change7d >= 0 ? '+' : ''}${change7d.toFixed(2)}%` : '-', '🗓️'),
                    '',
                    ui.kv('Tertinggi 24j', `$${ui.number(high24h)}`, '📈'),
                    ui.kv('Terendah 24j', `$${ui.number(low24h)}`, '📉'),
                    '',
                    ui.kv('Kapitalisasi', `$${ui.compactNumber(marketCap)}`, '💎'),
                    ui.kv('Volume 24j', `$${ui.compactNumber(volume24h)}`, '📊')
                ],
                footer: `${ui.sourceBadge(fromCache)} ${ui.SYM.dot} CoinGecko`
            });

            const thumbnail = data.image?.large;

            if (thumbnail) {
                await this.replyMedia(sock, from, msg, {
                    image: { url: thumbnail },
                    caption: info
                });
            } else {
                await this.reply(sock, from, msg, info);
            }

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, { context: 'send-crypto-info' });
            throw error;
        }
    }

}

module.exports = CryptoCommand;
