/**
 * Tag All Command
 * Mention all group members
 */

const CommandBase = require('./base');

class TagAllCommand extends CommandBase {
    constructor() {
        super({
            name: 'tagall',
            aliases: ['everyone', 'all', 'hidetag'],
            description: 'Tag semua anggota grup',
            usage: '.tagall [message]',
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
            
            const customMessage = args.join(' ') || 'Attention everyone!';
            
            let text = `🔊 *TAG ALL MEMBERS*\n`;
            text += `📢 ${customMessage}\n\n`;
            text += `Total: ${metadata.participants.length} members\n\n`;

            const mentions = [];

            for (const participant of metadata.participants) {
                const phoneNumber = participant.id.split('@')[0];
                text += `@${phoneNumber}\n`;
                mentions.push(participant.id);
            }

            text += `\n_Tagged by: @${msg.key.participant?.split('@')[0] || 'admin'}_`;
            
            if (msg.key.participant) {
                mentions.push(msg.key.participant);
            }

            await sock.sendMessage(from, {
                text: text,
                mentions: mentions
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Failed to tag members.');
        }
    }
}

module.exports = TagAllCommand;
