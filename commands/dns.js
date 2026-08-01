/**
 * DNS Command
 * Lookup DNS untuk domain
 */

const CommandBase = require('./base');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const dns = require('dns').promises;

class DNSCommand extends CommandBase {
    constructor() {
        super({
            name: 'dns',
            aliases: ['nslookup', 'dig', 'resolve'],
            description: 'Lookup DNS untuk domain',
            usage: '.dns google.com',
            category: 'technical',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🔍',
                title: 'DNS Lookup',
                description: 'Lihat record DNS yang terpasang pada sebuah domain.',
                usage: ['.dns <domain>'],
                examples: ['.dns google.com', '.dns facebook.com', '.nslookup youtube.com'],
                notes: ['Record dibaca: A, AAAA, MX, NS, TXT, dan CNAME']
            });
        }

        await this.react(sock, msg, '🔍');

        let domain = args[0].trim().toLowerCase();
        
        // Remove http/https prefix if present
        domain = domain.replace(/^https?:\/\//, '');
        // Remove trailing slashes and paths
        domain = domain.split('/')[0];

        // Basic domain validation
        if (!this.isValidDomain(domain)) {
            return await this.reply(sock, from, msg, 
                '❌ Format domain tidak valid!\n\nContoh: `.dns google.com`');
        }

        try {
            logger.info(`DNS: resolving ${domain}`);
            const results = await this.performLookup(domain);
            
            const lines = [];

            // Each block is pushed only when the record type resolved, so a
            // domain with just an A record produces a short, clean card rather
            // than a wall of empty headings.
            const addBlock = (heading, values) => {
                if (!values || values.length === 0) return;
                if (lines.length > 0) lines.push('');
                lines.push(heading);
                lines.push(...ui.bullets(values));
            };

            addBlock(`📍 ${ui.bold('A Record (IPv4)')}`, results.a);
            addBlock(`🌐 ${ui.bold('AAAA Record (IPv6)')}`, results.aaaa);

            if (results.mx && results.mx.length > 0) {
                addBlock(
                    `📧 ${ui.bold('MX Record (Mail)')}`,
                    [...results.mx]
                        .sort((a, b) => a.priority - b.priority)
                        .map(mx => `[${mx.priority}] ${mx.exchange}`)
                );
            }

            addBlock(`🖥️ ${ui.bold('NS Record (Nameserver)')}`, results.ns);

            if (results.txt && results.txt.length > 0) {
                // TXT records carry SPF/DKIM blobs that can be hundreds of
                // characters; only the first few, truncated, are useful here.
                const shown = results.txt.slice(0, 3).map(txt => ui.truncate(txt.join(''), 60));
                if (results.txt.length > 3) {
                    shown.push(ui.italic(`...dan ${results.txt.length - 3} lainnya`));
                }
                addBlock(`📝 ${ui.bold('TXT Record')}`, shown);
            }

            addBlock(`🔗 ${ui.bold('CNAME Record')}`, results.cname ? [results.cname[0]] : null);

            if (lines.length === 0) {
                this.setFailed(context, 'no DNS records');
                return await this.replyError(sock, from, msg,
                    'Tidak ada DNS record yang ditemukan.', {
                        title: 'Kosong',
                        hint: ['Periksa ejaan domainnya']
                    });
            }

            logger.info(`DNS: resolved ${domain}`);

            await this.reply(sock, from, msg, ui.card({
                icon: '🔍',
                title: ui.safe(domain, 60),
                lines,
                footer: `DNS lookup ${ui.SYM.dot} ${ui.clock()}`
            }));
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);

            const notFound = error.code === 'ENOTFOUND' || error.code === 'ENODATA';
            await this.replyError(sock, from, msg,
                notFound
                    ? `Domain ${ui.mono(ui.safe(domain, 60))} tidak ditemukan.`
                    : 'Gagal melakukan DNS lookup.', {
                    title: notFound ? 'Tidak Ditemukan' : 'Gagal',
                    hint: notFound
                        ? ['Periksa ejaan domainnya', '.dns google.com']
                        : ['Coba lagi sebentar lagi']
                });
        }
    }

    async performLookup(domain) {
        const results = {};

        // Perform lookups in parallel with error handling for each
        const lookups = [
            dns.resolve4(domain).then(r => results.a = r).catch(() => {}),
            dns.resolve6(domain).then(r => results.aaaa = r).catch(() => {}),
            dns.resolveMx(domain).then(r => results.mx = r).catch(() => {}),
            dns.resolveNs(domain).then(r => results.ns = r).catch(() => {}),
            dns.resolveTxt(domain).then(r => results.txt = r).catch(() => {}),
            dns.resolveCname(domain).then(r => results.cname = r).catch(() => {})
        ];

        await Promise.all(lookups);
        return results;
    }

    isValidDomain(domain) {
        // Basic domain validation
        const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/;
        return domainPattern.test(domain) && domain.length <= 253;
    }
}

module.exports = DNSCommand;
