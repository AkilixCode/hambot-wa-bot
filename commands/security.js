/**
 * Security Status Command
 * View security statistics and blocked users (Owner only)
 */

const CommandBase = require('./base');
const security = require('../utils/security');
const config = require('../config');

class SecurityCommand extends CommandBase {
    constructor() {
        super({
            name: 'security',
            aliases: ['sec', 'secstatus'],
            description: 'View security statistics (Owner only)',
            usage: '.security',
            category: 'system',
            cooldown: 5000
        });
    }

    async execute(sock, msg, args, context) {
        const { from, sender } = context;

        // Check if user is owner
        const ownerId = process.env.BOT_OWNER_ID;
        if (!ownerId || sender !== ownerId) {
            return await this.reply(sock, from, msg, '🔒 This command is owner-only.');
        }

        await this.react(sock, msg, '🔒');

        try {
            const stats = security.getStats();

            let response = 
`🔒 *SECURITY STATUS*

📊 **Statistics**
• Blocked Users: ${stats.blockedUsers}
• Suspicious Activity Tracked: ${stats.suspiciousActivityTracked}
• Security Events: ${stats.securityEvents}

`;

            if (stats.recentBlocks.length > 0) {
                response += `⛔ **Recent Blocks:**\n`;
                for (const block of stats.recentBlocks.slice(0, 5)) {
                    const timeLeft = Math.ceil(block.expiresIn / 1000);
                    response += `• User ***${block.userId}**: ${block.reason} (${timeLeft}s left)\n`;
                }
            } else {
                response += `✅ **No Active Blocks**\n`;
            }

            response += `\n🛡️ Security features active:\n`;
            response += `• Input sanitization\n`;
            response += `• Malicious pattern detection\n`;
            response += `• Rate limiting\n`;
            response += `• Command validation\n`;
            response += `• Permission checks\n`;
            response += `• Automatic blocking\n`;

            await this.reply(sock, from, msg, response);
            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to fetch security status.');
        }
    }
}

module.exports = SecurityCommand;
