/**
 * Group Info Command
 * Menampilkan metadata dan statistik grup
 */

const CommandBase = require('./base');

class InfoCommand extends CommandBase {
    constructor() {
        super({
            name: 'info',
            aliases: ['groupinfo', 'grup'],
            description: 'Menampilkan informasi dan statistik grup',
            usage: '.info',
            category: 'group',
            cooldown: 3000,
            requiresGroup: true
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '📋');

        try {
            const metadata = await sock.groupMetadata(from);

            const admins = metadata.participants.filter(p => 
                p.admin === 'admin' || p.admin === 'superadmin'
            ).length;

            const creationDate = new Date(metadata.creation * 1000)
                .toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                });

            const description = metadata.desc || 'Tidak ada deskripsi';
            const descTrimmed = description.length > 200 
                ? description.substring(0, 200) + '...' 
                : description;

            const info = 
`📋 *INFORMASI GRUP*

👥 *${metadata.subject}*

🆔 ID Grup: ${metadata.id}
📅 Dibuat: ${creationDate}
👥 Anggota: ${metadata.participants.length}
👑 Admin: ${admins}
🔒 Terbatas: ${metadata.restrict ? 'Ya' : 'Tidak'}
📢 Pengumuman: ${metadata.announce ? 'Ya' : 'Tidak'}

📝 *Deskripsi:*
${descTrimmed}`;

            await this.reply(sock, from, msg, info);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Gagal mendapatkan informasi grup.');
        }
    }
}

module.exports = InfoCommand;
