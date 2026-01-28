/**
 * Ping Command
 * Check bot response time and system status
 */

const CommandBase = require('./base');
const os = require('os');
const { formatSize } = require('../utils/helpers');
const cache = require('../utils/cache');

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

            const uptimeFormatted = this.formatUptime(uptime);

            const response = 
`💻 *STATUS SISTEM*

🖥️ **Info Sistem**
• Host: ${os.hostname()}
• OS: ${os.type()} ${os.arch()}
• CPU: ${cpus[0].model.substring(0, 40)}...
• Cores: ${cpus.length}

📊 **Penggunaan Memori**
• Bot: ${formatSize(mem)}
• Sistem: ${formatSize(totalMem - freeMem)} / ${formatSize(totalMem)}
• Tersedia: ${formatSize(freeMem)}

⚡ **Performa**
• Latensi: ${latency}ms
• Uptime: ${uptimeFormatted}

💾 **Stats Cache**
• Ukuran: ${cacheStats.size} entri
• Hit Rate: ${cacheStats.hitRate}
• Hits: ${cacheStats.hits} | Misses: ${cacheStats.misses}`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal mengambil status sistem.');
        }
    }

    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const parts = [];
        if (days > 0) parts.push(`${days}d`);
        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

        return parts.join(' ');
    }
}

module.exports = PingCommand;
