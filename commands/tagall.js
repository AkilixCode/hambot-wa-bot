/**
 * Tag All Command
 * Mention all group members
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');

class TagAllCommand extends CommandBase {
    constructor() {
        super({
            name: 'tagall',
            aliases: ['everyone', 'all', 'hidetag'],
            description: 'Tag semua anggota grup',
            usage: '.tagall [pesan]',
            category: 'group',
            cooldown: 10000, // 10 seconds cooldown
            requiresGroup: true
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '🔊');

        try {
            const metadata = await sock.groupMetadata(from);

            // User-supplied, and it is echoed back to the whole group — strip
            // markdown so nobody can smuggle formatting into everyone's chat.
            const customMessage = ui.safe(args.join(' '), 300) || 'Kumpul semuanya!';

            const mentions = [];
            const handles = [];

            for (const participant of metadata.participants) {
                handles.push(`@${participant.id.split('@')[0]}`);
                mentions.push(participant.id);
            }

            const tagger = msg.key.participant?.split('@')[0];
            if (msg.key.participant) {
                mentions.push(msg.key.participant);
            }

            const text = ui.card({
                icon: '🔊',
                title: 'Panggilan Grup',
                lines: [
                    `📢 ${customMessage}`,
                    '',
                    ui.kv('Total anggota', String(metadata.participants.length), '👥'),
                    '',
                    // Mentions must appear as bare @number for WhatsApp to
                    // resolve them, so they are not run through kv/bullets.
                    handles.join(' ')
                ],
                footer: tagger ? `Dipanggil oleh @${tagger}` : undefined
            });

            // Sent raw rather than via reply(): this is the one command that
            // needs the `mentions` array, which replyMedia/reply do not carry.
            await sock.sendMessage(from, {
                text: ui.clamp(text),
                mentions
            }, { quoted: msg });

            await this.react(sock, msg, '✅');
        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal menandai anggota grup.', {
                hint: ['Coba lagi sebentar lagi', 'Pastikan bot masih ada di grup ini']
            });
        }
    }
}

module.exports = TagAllCommand;
