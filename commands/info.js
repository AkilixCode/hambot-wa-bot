/**
 * Group Info Command
 * Menampilkan metadata dan statistik grup
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

class InfoCommand extends CommandBase {
    constructor() {
        super({
            name: 'info',
            aliases: ['groupinfo', 'grup'],
            description: 'Info dan statistik grup',
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

            // Subject and description are group-controlled text, so they are
            // stripped of markdown before being echoed back.
            const description = ui.safe(metadata.desc || '', 200) || 'Tidak ada deskripsi';

            const info = ui.card({
                icon: '📋',
                title: ui.safe(metadata.subject, 60),
                lines: [
                    ui.kv('Anggota', ui.number(metadata.participants.length), '👥'),
                    ui.kv('Admin', String(admins), '👑'),
                    ui.kv('Dibuat', creationDate, '📅'),
                    ui.kv('Terbatas', metadata.restrict ? 'Ya' : 'Tidak', '🔒'),
                    ui.kv('Pengumuman', metadata.announce ? 'Ya' : 'Tidak', '📢'),
                    ui.kv('ID Grup', ui.mono(metadata.id), '🆔'),
                    '',
                    `📝 ${ui.bold('Deskripsi')}`,
                    description
                ],
                footer: ui.clock()
            });

            await this.reply(sock, from, msg, info);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal mendapatkan informasi grup.', {
                hint: ['Coba lagi sebentar lagi']
            });
        }
    }
}

module.exports = InfoCommand;
