/**
 * Subnet Command
 * Kalkulator subnet untuk jaringan
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
const logger = require('../utils/logger');

class SubnetCommand extends CommandBase {
    constructor() {
        super({
            name: 'subnet',
            aliases: ['cidr', 'ipcalc', 'subnetcalc'],
            description: 'Hitung subnet dari IP dan CIDR',
            usage: '.subnet 192.168.1.0/24',
            category: 'technical',
            cooldown: 2000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🖥️',
                title: 'Kalkulator Subnet',
                description: 'Hitung network, broadcast, dan jumlah host dari sebuah blok IP.',
                usage: ['.subnet <IP>/<CIDR>'],
                examples: ['.subnet 192.168.1.0/24', '.subnet 10.0.0.0/8', '.subnet 172.16.0.0/16'],
                notes: [
                    '/8 = 16.777.214 host (Kelas A)',
                    '/16 = 65.534 host (Kelas B)',
                    '/24 = 254 host (Kelas C)',
                    '/26 = 62 host · /28 = 14 host · /30 = 2 host'
                ]
            });
        }

        await this.react(sock, msg, '🔢');

        try {
            const input = args[0];
            logger.info(`Subnet: calculating for ${input}`);
            const result = this.calculateSubnet(input);

            if (!result.valid) {
                return await this.replyError(sock, from, msg, ui.safe(result.error, 120), {
                    title: 'Input Tidak Valid',
                    hint: ['.subnet 192.168.1.0/24', 'Format: <ip>/<cidr>']
                });
            }

            const response = ui.card({
                icon: '🖥️',
                title: ui.safe(input, 40),
                lines: [
                    `📊 ${ui.bold('Informasi Network')}`,
                    ui.kv('Network', ui.mono(result.network), '🌐'),
                    ui.kv('Broadcast', ui.mono(result.broadcast), '📡'),
                    ui.kv('Subnet Mask', ui.mono(result.subnetMask), '🎭'),
                    ui.kv('Wildcard', ui.mono(result.wildcardMask), '🃏'),
                    ui.kv('CIDR', ui.mono(`/${result.cidr}`), '✂️'),
                    ui.kv('Range Usable', ui.mono(`${result.firstHost} - ${result.lastHost}`), '↔️'),
                    ui.kv('Total Host', ui.number(result.totalHosts), '🔢'),
                    ui.kv('Kelas IP', result.ipClass, '🏷️'),
                    ui.kv('Jenis', result.ipType, '🔖'),
                    '',
                    `${ui.EMOJI.tip} ${ui.bold('Rumus')}`,
                    ...ui.bullets([
                        `Total IP = 2^(32-${result.cidr}) = ${ui.number(result.totalAddresses)}`,
                        `Usable = Total - 2 = ${ui.number(result.totalHosts)}`
                    ])
                ],
                footer: ui.clock()
            });

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal menghitung subnet.', {
                hint: ['.subnet 192.168.1.0/24']
            });
        }
    }

    calculateSubnet(input) {
        // Parse input
        const match = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
        
        if (!match) {
            return { valid: false, error: 'Format salah! Gunakan: IP/CIDR (contoh: 192.168.1.0/24)' };
        }

        const octets = [
            parseInt(match[1]),
            parseInt(match[2]),
            parseInt(match[3]),
            parseInt(match[4])
        ];
        const cidr = parseInt(match[5]);

        // Validate octets
        for (const octet of octets) {
            if (octet < 0 || octet > 255) {
                return { valid: false, error: 'Oktet IP harus antara 0-255!' };
            }
        }

        // Validate CIDR
        if (cidr < 0 || cidr > 32) {
            return { valid: false, error: 'CIDR harus antara 0-32!' };
        }

        // Calculate subnet mask
        const maskBits = ~((1 << (32 - cidr)) - 1) >>> 0;
        const subnetMask = this.intToIP(maskBits);

        // Calculate wildcard mask
        const wildcardBits = ((1 << (32 - cidr)) - 1) >>> 0;
        const wildcardMask = this.intToIP(wildcardBits);

        // Calculate network address
        const ipInt = this.ipToInt(octets);
        const networkInt = (ipInt & maskBits) >>> 0;
        const network = this.intToIP(networkInt);

        // Calculate broadcast address
        const broadcastInt = (networkInt | wildcardBits) >>> 0;
        const broadcast = this.intToIP(broadcastInt);

        // Calculate usable range
        const totalAddresses = Math.pow(2, 32 - cidr);
        let totalHosts;
        
        // Special cases for /31 and /32
        if (cidr === 32) {
            totalHosts = 1; // Single host
        } else if (cidr === 31) {
            totalHosts = 2; // Point-to-point (RFC 3021)
        } else {
            totalHosts = Math.max(0, totalAddresses - 2);
        }
        
        let firstHost = 'N/A';
        let lastHost = 'N/A';
        
        if (cidr <= 30) {
            firstHost = this.intToIP(networkInt + 1);
            lastHost = this.intToIP(broadcastInt - 1);
        } else if (cidr === 31) {
            // Point-to-point link (RFC 3021)
            firstHost = network;
            lastHost = broadcast;
        } else if (cidr === 32) {
            firstHost = network;
            lastHost = network;
        }

        // Determine IP class
        const ipClass = this.getIPClass(octets[0]);
        const ipType = this.getIPType(octets);

        return {
            valid: true,
            network,
            broadcast,
            subnetMask,
            wildcardMask,
            cidr,
            firstHost,
            lastHost,
            totalAddresses,
            totalHosts,
            ipClass,
            ipType
        };
    }

    ipToInt(octets) {
        return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
    }

    intToIP(num) {
        return [
            (num >>> 24) & 255,
            (num >>> 16) & 255,
            (num >>> 8) & 255,
            num & 255
        ].join('.');
    }

    getIPClass(firstOctet) {
        if (firstOctet >= 1 && firstOctet <= 126) return 'A';
        if (firstOctet >= 128 && firstOctet <= 191) return 'B';
        if (firstOctet >= 192 && firstOctet <= 223) return 'C';
        if (firstOctet >= 224 && firstOctet <= 239) return 'D (Multicast)';
        if (firstOctet >= 240 && firstOctet <= 255) return 'E (Reserved)';
        return 'Loopback';
    }

    getIPType(octets) {
        const [a, b, c, d] = octets;
        
        // Private ranges
        if (a === 10) return 'Private (RFC 1918)';
        if (a === 172 && b >= 16 && b <= 31) return 'Private (RFC 1918)';
        if (a === 192 && b === 168) return 'Private (RFC 1918)';
        
        // Special ranges
        if (a === 127) return 'Loopback';
        if (a === 0) return 'This Network';
        if (a === 169 && b === 254) return 'Link-Local (APIPA)';
        if (a >= 224 && a <= 239) return 'Multicast';
        if (a >= 240) return 'Reserved';
        
        return 'Public';
    }
}

module.exports = SubnetCommand;
