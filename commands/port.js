/**
 * Port Command
 * Referensi port jaringan umum
 */

const CommandBase = require('./base');

class PortCommand extends CommandBase {
    constructor() {
        super({
            name: 'port',
            aliases: ['ports', 'portlist', 'portinfo'],
            description: 'Referensi port jaringan umum',
            usage: '.port [nomor/protokol]',
            category: 'technical',
            cooldown: 2000
        });

        // Database port umum
        this.ports = {
            // Well-known ports (0-1023)
            20: { name: 'FTP Data', protocol: 'TCP', desc: 'File Transfer Protocol - Data transfer' },
            21: { name: 'FTP Control', protocol: 'TCP', desc: 'File Transfer Protocol - Control/command' },
            22: { name: 'SSH', protocol: 'TCP', desc: 'Secure Shell - Remote login terenkripsi' },
            23: { name: 'Telnet', protocol: 'TCP', desc: 'Telnet - Remote login (tidak aman!)' },
            25: { name: 'SMTP', protocol: 'TCP', desc: 'Simple Mail Transfer Protocol - Kirim email' },
            53: { name: 'DNS', protocol: 'TCP/UDP', desc: 'Domain Name System - Resolusi domain' },
            67: { name: 'DHCP Server', protocol: 'UDP', desc: 'Dynamic Host Configuration Protocol' },
            68: { name: 'DHCP Client', protocol: 'UDP', desc: 'DHCP Client' },
            69: { name: 'TFTP', protocol: 'UDP', desc: 'Trivial File Transfer Protocol' },
            80: { name: 'HTTP', protocol: 'TCP', desc: 'HyperText Transfer Protocol - Web' },
            110: { name: 'POP3', protocol: 'TCP', desc: 'Post Office Protocol - Terima email' },
            119: { name: 'NNTP', protocol: 'TCP', desc: 'Network News Transfer Protocol' },
            123: { name: 'NTP', protocol: 'UDP', desc: 'Network Time Protocol - Sinkronisasi waktu' },
            135: { name: 'RPC', protocol: 'TCP', desc: 'Remote Procedure Call (Windows)' },
            137: { name: 'NetBIOS Name', protocol: 'UDP', desc: 'NetBIOS Name Service' },
            138: { name: 'NetBIOS Datagram', protocol: 'UDP', desc: 'NetBIOS Datagram Service' },
            139: { name: 'NetBIOS Session', protocol: 'TCP', desc: 'NetBIOS Session Service' },
            143: { name: 'IMAP', protocol: 'TCP', desc: 'Internet Message Access Protocol' },
            161: { name: 'SNMP', protocol: 'UDP', desc: 'Simple Network Management Protocol' },
            162: { name: 'SNMP Trap', protocol: 'UDP', desc: 'SNMP Trap' },
            389: { name: 'LDAP', protocol: 'TCP', desc: 'Lightweight Directory Access Protocol' },
            443: { name: 'HTTPS', protocol: 'TCP', desc: 'HTTP Secure - Web terenkripsi' },
            445: { name: 'SMB', protocol: 'TCP', desc: 'Server Message Block - File sharing' },
            465: { name: 'SMTPS', protocol: 'TCP', desc: 'SMTP Secure' },
            514: { name: 'Syslog', protocol: 'UDP', desc: 'System Logging Protocol' },
            587: { name: 'SMTP Submission', protocol: 'TCP', desc: 'Email Submission' },
            636: { name: 'LDAPS', protocol: 'TCP', desc: 'LDAP Secure' },
            993: { name: 'IMAPS', protocol: 'TCP', desc: 'IMAP Secure' },
            995: { name: 'POP3S', protocol: 'TCP', desc: 'POP3 Secure' },
            
            // Registered ports (1024-49151)
            1433: { name: 'MSSQL', protocol: 'TCP', desc: 'Microsoft SQL Server' },
            1521: { name: 'Oracle', protocol: 'TCP', desc: 'Oracle Database' },
            3306: { name: 'MySQL', protocol: 'TCP', desc: 'MySQL Database' },
            3389: { name: 'RDP', protocol: 'TCP', desc: 'Remote Desktop Protocol (Windows)' },
            5432: { name: 'PostgreSQL', protocol: 'TCP', desc: 'PostgreSQL Database' },
            5900: { name: 'VNC', protocol: 'TCP', desc: 'Virtual Network Computing' },
            6379: { name: 'Redis', protocol: 'TCP', desc: 'Redis Database' },
            8080: { name: 'HTTP Proxy', protocol: 'TCP', desc: 'HTTP Alternative/Proxy' },
            8443: { name: 'HTTPS Alt', protocol: 'TCP', desc: 'HTTPS Alternative' },
            27017: { name: 'MongoDB', protocol: 'TCP', desc: 'MongoDB Database' }
        };
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        // Jika tidak ada argumen, tampilkan daftar port umum
        if (!args[0]) {
            return await this.sendPortList(sock, from, msg);
        }

        await this.react(sock, msg, '🔌');

        const query = args[0].toLowerCase();

        try {
            // Cek apakah query adalah nomor port
            if (/^\d+$/.test(query)) {
                const portNum = parseInt(query);
                return await this.sendPortInfo(sock, from, msg, portNum);
            }

            // Cek apakah query adalah nama protokol/service
            return await this.searchPort(sock, from, msg, query);
        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal mencari informasi port.');
        }
    }

    async sendPortList(sock, from, msg) {
        const response = 
`╔══════════════════════════════╗
║  🔌 *REFERENSI PORT JARINGAN*  ║
╚══════════════════════════════╝

📝 *Cara Pakai:*
• \`.port 22\` - Info port 22
• \`.port ssh\` - Cari port SSH
• \`.port http\` - Cari port HTTP

┌──────────────────────────────┐
│ 🌐 *PORT PALING UMUM:*
├──────────────────────────────
│ 20-21  │ FTP (Transfer File)
│ 22     │ SSH (Remote Shell)
│ 23     │ Telnet (Remote Login)
│ 25     │ SMTP (Kirim Email)
│ 53     │ DNS (Domain Name)
│ 67-68  │ DHCP (IP Otomatis)
│ 80     │ HTTP (Web)
│ 110    │ POP3 (Email)
│ 143    │ IMAP (Email)
│ 443    │ HTTPS (Web Secure)
│ 445    │ SMB (File Sharing)
│ 3389   │ RDP (Remote Desktop)
└──────────────────────────────┘

┌──────────────────────────────┐
│ 🗄️ *DATABASE PORTS:*
├──────────────────────────────
│ 1433   │ MS SQL Server
│ 3306   │ MySQL
│ 5432   │ PostgreSQL
│ 6379   │ Redis
│ 27017  │ MongoDB
└──────────────────────────────┘

💡 *Tips:*
• Port 0-1023: Well-known ports
• Port 1024-49151: Registered ports
• Port 49152-65535: Dynamic/private`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }

    async sendPortInfo(sock, from, msg, portNum) {
        const portInfo = this.ports[portNum];

        if (!portInfo) {
            // Port tidak ada di database
            let category = 'Dynamic/Private';
            if (portNum <= 1023) category = 'Well-known';
            else if (portNum <= 49151) category = 'Registered';

            return await this.reply(sock, from, msg, 
                `🔌 *Port ${portNum}*\n\n` +
                `📊 Kategori: ${category}\n` +
                `❓ Status: Tidak ada di database\n\n` +
                `💡 Port ini mungkin digunakan oleh layanan custom atau tidak umum.`);
        }

        const response = 
`╔══════════════════════════════╗
║  🔌 *INFO PORT ${portNum}*  ║
╚══════════════════════════════╝

┌──────────────────────────────┐
│ 🏷️ Nama      : ${portInfo.name}
│ 🔢 Port      : ${portNum}
│ 📡 Protokol  : ${portInfo.protocol}
│ 📝 Deskripsi : ${portInfo.desc}
└──────────────────────────────┘

💡 *Kategori:* ${portNum <= 1023 ? 'Well-known Port' : 'Registered Port'}`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }

    async searchPort(sock, from, msg, query) {
        const results = [];

        for (const [port, info] of Object.entries(this.ports)) {
            if (
                info.name.toLowerCase().includes(query) ||
                info.desc.toLowerCase().includes(query)
            ) {
                results.push({ port: parseInt(port), ...info });
            }
        }

        if (results.length === 0) {
            return await this.reply(sock, from, msg, 
                `❌ Tidak ditemukan port dengan kata kunci "${query}"\n\n` +
                `Coba: \`.port ssh\`, \`.port http\`, \`.port mysql\``);
        }

        const sections = [];
        sections.push('╔══════════════════════════════╗');
        sections.push(`║  🔍 *HASIL PENCARIAN: ${query.toUpperCase()}*  ║`);
        sections.push('╚══════════════════════════════╝');
        sections.push('');

        for (const result of results.slice(0, 10)) {
            sections.push(`┌──────────────────────────────┐`);
            sections.push(`│ 🔌 *Port ${result.port}* - ${result.name}`);
            sections.push(`│ 📡 ${result.protocol} | ${result.desc}`);
            sections.push(`└──────────────────────────────┘`);
        }

        if (results.length > 10) {
            sections.push(`\n_...dan ${results.length - 10} hasil lainnya_`);
        }

        await this.reply(sock, from, msg, sections.join('\n'));
        await this.react(sock, msg, '✅');
    }
}

module.exports = PortCommand;
