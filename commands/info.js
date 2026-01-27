/**
 * Group Info Command
 * Display group metadata and statistics
 */

const CommandBase = require('./base');

class InfoCommand extends CommandBase {
    constructor() {
        super({
            name: 'info',
            aliases: ['groupinfo', 'grup'],
            description: 'Display group information and statistics',
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

            const description = metadata.desc || 'No description';
            const descTrimmed = description.length > 200 
                ? description.substring(0, 200) + '...' 
                : description;

            const info = 
`📋 *GROUP INFORMATION*

👥 *${metadata.subject}*

🆔 Group ID: ${metadata.id}
📅 Created: ${creationDate}
👥 Members: ${metadata.participants.length}
👑 Admins: ${admins}
🔒 Restrict: ${metadata.restrict ? 'Yes' : 'No'}
📢 Announce: ${metadata.announce ? 'Yes' : 'No'}

📝 *Description:*
${descTrimmed}`;

            await this.reply(sock, from, msg, info);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to get group information.');
        }
    }
}

module.exports = InfoCommand;
