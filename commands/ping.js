/**
 * Ping Command
 * Check bot response time and system status
 */

const CommandBase = require('./base');
const logger = require('../utils/logger');
const os = require('os');
const { formatSize } = require('../utils/helpers');
const cache = require('../utils/cache');
const config = require('../config');
const ui = require('../utils/ui');

class PingCommand extends CommandBase {
    constructor() {
        super({
            name: 'ping',
            aliases: ['p', 'status'],
            description: 'Cek waktu respon dan status sistem',
            usage: '.ping',
            category: 'system',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;
        const startTime = Date.now();

        await this.react(sock, msg, '💻');

        try {
            logger.info('Ping: measuring latency...');
            // Get system info
            const cpus = os.cpus();
            const mem = process.memoryUsage().rss;
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const uptime = Math.floor(process.uptime());
            
            // Calculate latency
            const latency = Date.now() - startTime;

            // Get cache stats
            const cacheStats = cache.getStats();

            const usedMem = totalMem - freeMem;
            const memPercent = (usedMem / totalMem) * 100;

            await this.reply(sock, from, msg, ui.card({
                icon: '💻',
                title: ui.smallCaps('Status Sistem'),
                lines: [
                    `⚡ ${ui.bold('Performa')}`,
                    ui.kv('Latensi', `${latency} ms`),
                    ui.kv('Uptime', ui.uptime(uptime)),
                    ui.kv('Versi', `v${config.bot.version}`),
                    '',
                    `📊 ${ui.bold('Memori')}`,
                    ui.kv('Bot', formatSize(mem)),
                    ui.kv('Sistem', `${formatSize(usedMem)} / ${formatSize(totalMem)}`),
                    ui.meter(memPercent),
                    '',
                    `🖥️ ${ui.bold('Mesin')}`,
                    ui.kv('OS', `${os.type()} ${os.arch()}`),
                    ui.kv('CPU', `${ui.truncate(cpus[0].model, 32)} (${cpus.length} core)`),
                    '',
                    `💾 ${ui.bold('Cache')}`,
                    ui.kv('Entri', `${cacheStats.size}`),
                    ui.kv('Hit rate', `${cacheStats.hitRate} (${cacheStats.hits}/${cacheStats.hits + cacheStats.misses})`)
                ],
                footer: `${config.bot.name} ${ui.SYM.dot} ${ui.clock()}`
            }));
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Tidak bisa membaca status sistem.', {
                hint: ['Coba lagi sebentar lagi']
            });
        }
    }
}

module.exports = PingCommand;
