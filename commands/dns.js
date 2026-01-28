/**
 * DNS Command
 * Lookup DNS untuk domain
 */

const CommandBase = require('./base');
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
            return await this.reply(sock, from, msg, 
                '🔍 *DNS Lookup*\n\n' +
                '📝 *Cara Pakai:*\n' +
                '`.dns <domain>`\n\n' +
                '📌 *Contoh:*\n' +
                '• `.dns google.com`\n' +
                '• `.dns facebook.com`\n' +
                '• `.nslookup youtube.com`\n\n' +
                '📊 *Record yang Dicari:*\n' +
                '• A Record (IPv4)\n' +
                '• AAAA Record (IPv6)\n' +
                '• MX Record (Mail)\n' +
                '• NS Record (Nameserver)\n' +
                '• TXT Record\n' +
                '• CNAME Record');
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
            const results = await this.performLookup(domain);
            
            const sections = [];
            sections.push('╔══════════════════════════════╗');
            sections.push('║  🔍 *HASIL DNS LOOKUP*  ║');
            sections.push('╚══════════════════════════════╝');
            sections.push('');
            sections.push(`📥 *Domain:* ${domain}`);
            sections.push('');

            // A Records (IPv4)
            if (results.a && results.a.length > 0) {
                sections.push('┌──────────────────────────────┐');
                sections.push('│ 📍 *A Record (IPv4):*');
                sections.push('├──────────────────────────────');
                for (const ip of results.a) {
                    sections.push(`│ ▸ ${ip}`);
                }
                sections.push('└──────────────────────────────┘');
                sections.push('');
            }

            // AAAA Records (IPv6)
            if (results.aaaa && results.aaaa.length > 0) {
                sections.push('┌──────────────────────────────┐');
                sections.push('│ 🌐 *AAAA Record (IPv6):*');
                sections.push('├──────────────────────────────');
                for (const ip of results.aaaa) {
                    sections.push(`│ ▸ ${ip}`);
                }
                sections.push('└──────────────────────────────┘');
                sections.push('');
            }

            // MX Records
            if (results.mx && results.mx.length > 0) {
                sections.push('┌──────────────────────────────┐');
                sections.push('│ 📧 *MX Record (Mail):*');
                sections.push('├──────────────────────────────');
                for (const mx of results.mx.sort((a, b) => a.priority - b.priority)) {
                    sections.push(`│ ▸ [${mx.priority}] ${mx.exchange}`);
                }
                sections.push('└──────────────────────────────┘');
                sections.push('');
            }

            // NS Records
            if (results.ns && results.ns.length > 0) {
                sections.push('┌──────────────────────────────┐');
                sections.push('│ 🖥️ *NS Record (Nameserver):*');
                sections.push('├──────────────────────────────');
                for (const ns of results.ns) {
                    sections.push(`│ ▸ ${ns}`);
                }
                sections.push('└──────────────────────────────┘');
                sections.push('');
            }

            // TXT Records (show first 3)
            if (results.txt && results.txt.length > 0) {
                sections.push('┌──────────────────────────────┐');
                sections.push('│ 📝 *TXT Record:*');
                sections.push('├──────────────────────────────');
                const txtToShow = results.txt.slice(0, 3);
                for (const txt of txtToShow) {
                    const txtStr = txt.join('');
                    // Truncate long TXT records
                    const truncated = txtStr.length > 60 ? txtStr.substring(0, 57) + '...' : txtStr;
                    sections.push(`│ ▸ ${truncated}`);
                }
                if (results.txt.length > 3) {
                    sections.push(`│ _...dan ${results.txt.length - 3} record lainnya_`);
                }
                sections.push('└──────────────────────────────┘');
                sections.push('');
            }

            // CNAME Record (dns.resolveCname returns an array)
            if (results.cname && results.cname.length > 0) {
                sections.push('┌──────────────────────────────┐');
                sections.push('│ 🔗 *CNAME Record:*');
                sections.push('├──────────────────────────────');
                sections.push(`│ ▸ ${results.cname[0]}`);
                sections.push('└──────────────────────────────┘');
                sections.push('');
            }

            // Check if any records found
            const hasCname = results.cname && results.cname.length > 0;
            if (!results.a && !results.aaaa && !results.mx && !results.ns && !results.txt && !hasCname) {
                sections.push('❌ Tidak ada DNS record yang ditemukan.');
            }

            await this.reply(sock, from, msg, sections.join('\n'));
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            
            let errorMsg = '❌ Gagal melakukan DNS lookup.';
            if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
                errorMsg = `❌ Domain "${domain}" tidak ditemukan atau tidak memiliki DNS record.`;
            }
            
            await this.reply(sock, from, msg, errorMsg);
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
