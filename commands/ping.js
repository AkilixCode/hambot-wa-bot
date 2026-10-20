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
const groupCache = require('../utils/group-cache');
const { heavy: heavySlots } = require('../utils/work-slots');

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
        // From the handler's first look at the message, so the number covers
        // the checks and lookups before this command, not just this line.
        const startTime = context.startTime || Date.now();

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

            // How long WhatsApp took to deliver the message. Its timestamp
            // has one-second resolution, so this is a rough figure.
            const sentAt = Number(msg.messageTimestamp) * 1000;
            const delivery = sentAt ? Math.max(0, Date.now() - sentAt) : null;

            // Get cache stats
            const cacheStats = cache.getStats();
            const groups = groupCache.stats();

            const usedMem = totalMem - freeMem;
            const memPercent = (usedMem / totalMem) * 100;

            await this.reply(sock, from, msg, ui.card({
                icon: '💻',
                title: ui.smallCaps('Status Sistem'),
                lines: [
                    `⚡ ${ui.bold('Performa')}`,
                    ui.kv('Proses', `${latency} ms`),
                    ...(delivery !== null ? [ui.kv('Pengiriman', `±${(delivery / 1000).toFixed(1)} s`)] : []),
                    ui.kv('Tugas berat', `${heavySlots.active}/${config.performance.maxProcesses} jalan, ${heavySlots.waiting} antre`),
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
                    ui.kv('Hit rate', `${cacheStats.hitRate} (${cacheStats.hits}/${cacheStats.hits + cacheStats.misses})`),
                    ui.kv('Grup', `${groups.groups} grup, hit ${(groups.hitRate * 100).toFixed(0)}% (${groups.hits}/${groups.hits + groups.misses})`)
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
