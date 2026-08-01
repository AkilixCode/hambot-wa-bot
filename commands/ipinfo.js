/**
 * IPInfo Command
 * Dapatkan informasi alamat IP
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const { cachedFetch } = require('../utils/cached-fetch');

// GeoIP data for an address barely changes, so an hour is conservative.
const CACHE_TTL_MS = 3600000;

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
            return await this.replyUsage(sock, from, msg, {
                icon: '🌐',
                title: 'Info Alamat IP',
                description: 'Cek lokasi, ISP, dan organisasi pemilik sebuah alamat IP.',
                usage: ['.ipinfo <alamat IP>'],
                examples: ['.ipinfo 8.8.8.8', '.ipinfo 1.1.1.1'],
                notes: ['Lokasi berasal dari basis data GeoIP, jadi sifatnya perkiraan']
            });
        }

        await this.react(sock, msg, '🔍');

        const ipAddress = args[0].trim();

        // Validate IP format
        if (!this.isValidIP(ipAddress)) {
            return await this.replyError(sock, from, msg, 'Format IP tidak valid.', {
                title: 'IP Tidak Valid',
                hint: ['.ipinfo 8.8.8.8', 'Gunakan format IPv4: x.x.x.x']
            });
        }

        try {
            const { data, fromCache } = await cachedFetch(
                `ipinfo:${ipAddress}`,
                CACHE_TTL_MS,
                async () => {
                    // ip-api.com free tier is HTTP-only.
                    logger.info(`IPInfo: looking up ${ipAddress}`);
                    const res = await httpClient.get(
                        `http://ip-api.com/json/${ipAddress}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`,
                        { timeout: 10000 }
                    );
                    return res.data;
                },
                // A lookup failure must not be cached for an hour — the address
                // may simply have been rate-limited.
                { isCacheable: (value) => value && value.status !== 'fail' }
            );

            if (data.status === 'fail') {
                return await this.replyError(sock, from, msg,
                    ui.safe(data.message || 'IP tidak ditemukan.', 100), {
                        title: 'Tidak Ditemukan',
                        hint: ['Pastikan IP-nya publik, bukan IP lokal']
                    });
            }

            await this.sendIPInfo(sock, from, msg, data, fromCache);
        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal mendapatkan informasi IP.', {
                hint: ['Coba lagi sebentar lagi']
            });
        }
    }

    async sendIPInfo(sock, from, msg, data, fromCache) {
        const response = ui.card({
            icon: '🌐',
            title: data.query,
            lines: [
                `🗺️ ${ui.bold('Lokasi')}`,
                ui.kv('Negara', `${data.country} (${data.countryCode})`, '🏳️'),
                ui.kv('Kota', data.city || 'N/A', '🏙️'),
                ui.kv('Region', data.regionName || 'N/A', '📍'),
                data.zip && ui.kv('Kode Pos', data.zip, '📮'),
                ui.kv('Koordinat', `${data.lat}, ${data.lon}`, '🧭'),
                ui.kv('Zona Waktu', data.timezone || 'N/A', '🕘'),
                '',
                `🏢 ${ui.bold('Jaringan')}`,
                ui.kv('ISP', ui.truncate(data.isp || 'N/A', 45), '📡'),
                ui.kv('Organisasi', ui.truncate(data.org || 'N/A', 45), '🏛️'),
                ui.kv('ASN', ui.truncate(data.as || 'N/A', 45), '🔢'),
                '',
                `${ui.EMOJI.tip} _Lokasi berdasarkan GeoIP, sifatnya perkiraan_`
            ],
            footer: `${ui.sourceBadge(fromCache)} ${ui.SYM.dot} ${ui.clock()}`
        });

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
