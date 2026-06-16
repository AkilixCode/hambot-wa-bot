/**
 * IPInfo Command
 * Dapatkan informasi alamat IP
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const logger = require('../utils/logger');

class IPInfoCommand extends CommandBase {
    constructor() {
        super({
            name: 'ipinfo',
            aliases: ['ip', 'whois', 'ipcheck'],
            description: 'Dapatkan informasi alamat IP',
            usage: '.ipinfo 8.8.8.8',
            category: 'technical',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '🌐 *IP Info Lookup*\n\n' +
                '📝 *Cara Pakai:*\n' +
                '`.ipinfo <alamat IP>`\n\n' +
                '📌 *Contoh:*\n' +
                '• `.ipinfo 8.8.8.8`\n' +
                '• `.ipinfo 1.1.1.1`\n' +
                '• `.ip 203.89.24.5`\n\n' +
                '💡 *Tips:*\n' +
                '• Gunakan untuk cek lokasi IP\n' +
                '• Cek ISP dan organisasi\n' +
                '• Identifikasi negara asal');
        }

        await this.react(sock, msg, '🔍');

        const ipAddress = args[0].trim();

        // Validate IP format
        if (!this.isValidIP(ipAddress)) {
            return await this.reply(sock, from, msg, 
                '❌ Format IP tidak valid!\n\nContoh: `.ipinfo 8.8.8.8`');
        }

        // Check cache
        const cacheKey = `ipinfo:${ipAddress}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            return await this.sendIPInfo(sock, from, msg, cached, true);
        }

        try {
            // Use ip-api.com - Note: free tier only supports HTTP
            // For production with sensitive data, consider using ipinfo.io or ipdata.co
            logger.info(`IPInfo: looking up ${ipAddress}`);
            const { data } = await httpClient.get(
                `http://ip-api.com/json/${ipAddress}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`,
                { timeout: 10000 }
            );
            logger.info('IPInfo: data received');

            if (data.status === 'fail') {
                return await this.reply(sock, from, msg, 
                    `❌ Gagal mendapatkan info IP: ${data.message}`);
            }

            // Cache for 1 hour
            cache.set(cacheKey, data, 3600000);

            await this.sendIPInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal mendapatkan informasi IP.');
        }
    }

    async sendIPInfo(sock, from, msg, data, fromCache) {
        const response = 
`🌐 *INFORMASI ALAMAT IP*

📥 *IP:* ${data.query}

🗺️ *Lokasi*
• Negara: ${data.country} (${data.countryCode})
• Kota: ${data.city || 'N/A'}
• Region: ${data.regionName || 'N/A'}
• Kode Pos: ${data.zip || 'N/A'}
• Koordinat: ${data.lat}, ${data.lon}
• Timezone: ${data.timezone || 'N/A'}

🏢 *Network*
• ISP: ${data.isp || 'N/A'}
• Organisasi: ${data.org || 'N/A'}
• ASN: ${data.as || 'N/A'}

${fromCache ? '📦 _(dari cache)_' : '🔄 _Data langsung_'}

💡 _Lokasi berdasarkan GeoIP_`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }

    isValidIP(ip) {
        // IPv4 validation
        const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const match = ip.match(ipv4Pattern);
        
        if (!match) return false;
        
        for (let i = 1; i <= 4; i++) {
            const octet = parseInt(match[i]);
            if (octet < 0 || octet > 255) return false;
        }
        
        return true;
    }
}

module.exports = IPInfoCommand;
