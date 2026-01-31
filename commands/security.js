/**
 * Security Command
 * Comprehensive security management for bot owners
 * 
 * Commands:
 * .security - Show status and help
 * .security status - Show detailed security status
 * .security stop <code> - Stop PM2 bot process (requires confirmation code)
 * .security disable <feature> - Disable security feature
 * .security enable <feature> - Enable security feature
 * .security unblock <number> - Unblock a specific user
 * .security unblock all - Unblock all users
 * .security block <number> <minutes> - Block a user manually
 * .security list - List all blocked users
 * .security code - Generate new confirmation code for dangerous operations
 */

const CommandBase = require('./base');
const security = require('../utils/security');
const config = require('../config');
const { spawn } = require('child_process');
const crypto = require('crypto');

class SecurityCommand extends CommandBase {
    constructor() {
        super({
            name: 'security',
            aliases: ['sec', 'secstatus'],
            description: 'Security management panel (Owner only)',
            usage: '.security [subcommand] [args]',
            category: 'system',
            cooldown: 2000
        });

        // Store confirmation codes for dangerous operations
        // Maps owner ID -> { code: string, expires: number, operation: string }
        this.confirmationCodes = new Map();
        
        // Code expiry time (60 seconds)
        this.codeExpiryMs = 60000;
    }

    /**
     * Generate a random 6-character confirmation code
     * @returns {string}
     */
    generateConfirmationCode() {
        return crypto.randomBytes(3).toString('hex').toUpperCase();
    }

    /**
     * Check if a confirmation code is valid
     * @param {string} userId - Owner user ID
     * @param {string} code - Code to verify
     * @param {string} operation - Expected operation type
     * @returns {boolean}
     */
    verifyConfirmationCode(userId, code, operation) {
        const stored = this.confirmationCodes.get(userId);
        if (!stored) return false;
        
        // Check expiry
        if (Date.now() > stored.expires) {
            this.confirmationCodes.delete(userId);
            return false;
        }

        // Check code and operation match
        if (stored.code === code && stored.operation === operation) {
            this.confirmationCodes.delete(userId); // One-time use
            return true;
        }

        return false;
    }

    /**
     * Store a confirmation code for dangerous operations
     * @param {string} userId - Owner user ID
     * @param {string} operation - Operation type (stop, disable_all, etc.)
     * @returns {string} - The generated code
     */
    storeConfirmationCode(userId, operation) {
        const code = this.generateConfirmationCode();
        this.confirmationCodes.set(userId, {
            code,
            operation,
            expires: Date.now() + this.codeExpiryMs
        });
        return code;
    }

    async execute(sock, msg, args, context) {
        const { from, sender } = context;

        // CRITICAL: Verify owner identity
        const ownerId = process.env.BOT_OWNER_ID;
        if (!ownerId) {
            return await this.reply(sock, from, msg, 
                '⚠️ *Security Warning*\n\n' +
                'BOT_OWNER_ID is not configured!\n' +
                'Set it in your .env file to enable security commands.');
        }

        if (sender !== ownerId) {
            // Log unauthorized access attempt
            security.logSecurityEvent('unauthorized_security_access', {
                userId: sender,
                attemptedCommand: args.join(' ')
            });
            return await this.reply(sock, from, msg, '🔒 This command is owner-only.');
        }

        await this.react(sock, msg, '🔒');

        const subcommand = args[0]?.toLowerCase() || 'help';

        try {
            switch (subcommand) {
                case 'help':
                    return await this.showHelp(sock, from, msg);
                    
                case 'status':
                    return await this.showStatus(sock, from, msg);
                    
                case 'stop':
                    return await this.handleStop(sock, from, msg, args.slice(1), sender);
                    
                case 'disable':
                    return await this.handleDisable(sock, from, msg, args.slice(1));
                    
                case 'enable':
                    return await this.handleEnable(sock, from, msg, args.slice(1));
                    
                case 'unblock':
                    return await this.handleUnblock(sock, from, msg, args.slice(1));
                    
                case 'block':
                    return await this.handleBlock(sock, from, msg, args.slice(1));
                    
                case 'list':
                    return await this.listBlockedUsers(sock, from, msg);
                    
                case 'code':
                    return await this.generateCode(sock, from, msg, args.slice(1), sender);
                    
                default:
                    return await this.showHelp(sock, from, msg);
            }
        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Security command failed: ' + error.message);
        }
    }

    async showHelp(sock, from, msg) {
        const helpText = 
`🔒 *SECURITY MANAGEMENT PANEL*

📌 *Available Commands:*

*Status & Info*
\`.security status\` - Show detailed status
\`.security list\` - List blocked users

*Feature Control*
\`.security enable <feature>\` - Enable feature
\`.security disable <feature>\` - Disable feature

*User Management*
\`.security unblock <number>\` - Unblock user
\`.security unblock all\` - Unblock all users
\`.security block <number> <mins>\` - Block user

*Dangerous Operations*
\`.security code stop\` - Generate stop code
\`.security stop <code>\` - Stop bot (PM2)

🛡️ *Features:* chatFilter, rateLimit, autoBlock

⚠️ Dangerous operations require confirmation codes.`;

        await this.reply(sock, from, msg, helpText);
        await this.react(sock, msg, '✅');
    }

    async showStatus(sock, from, msg) {
        const stats = security.getStats();
        const configChatFilter = config.security.chatFilterEnabled;
        
        let response = 
`🔒 *SECURITY STATUS*

📊 *Statistics*
• Blocked Users: ${stats.blockedUsers}
• Suspicious Activity: ${stats.suspiciousActivityTracked}
• Security Events: ${stats.securityEvents}

⚙️ *Config Settings*
• Chat Filter (config): ${configChatFilter ? '✅ ON' : '❌ OFF'}

🔄 *Runtime Settings*
• Chat Filter: ${stats.runtimeSettings.chatFilterEnabled ? '✅ ON' : '❌ OFF'}
• Rate Limiting: ${stats.runtimeSettings.rateLimitEnabled ? '✅ ON' : '❌ OFF'}
• Auto-Block: ${stats.runtimeSettings.autoBlockEnabled ? '✅ ON' : '❌ OFF'}

`;

        if (stats.recentBlocks.length > 0) {
            response += `⛔ *Recent Blocks:*\n`;
            for (const block of stats.recentBlocks.slice(0, 5)) {
                const timeLeft = Math.ceil(block.expiresIn / 1000 / 60);
                response += `• ${block.userId}: ${block.reason} (${timeLeft}m left)\n`;
            }
        } else {
            response += `✅ *No Active Blocks*\n`;
        }

        response += `\n🛡️ *Active Protections:*\n`;
        response += `• Input sanitization\n`;
        response += `• Malicious pattern detection\n`;
        response += `• Permission checks\n`;
        response += `• Expression tag whitelist\n`;

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }

    async handleStop(sock, from, msg, args, sender) {
        const code = args[0]?.toUpperCase();
        
        if (!code) {
            // Generate a new code for stop operation
            const newCode = this.storeConfirmationCode(sender, 'stop');
            return await this.reply(sock, from, msg, 
                `⚠️ *DANGEROUS OPERATION*\n\n` +
                `This will stop the bot process via PM2.\n\n` +
                `To confirm, use:\n` +
                `\`.security stop ${newCode}\`\n\n` +
                `⏰ Code expires in 60 seconds.`);
        }

        // Verify the confirmation code
        if (!this.verifyConfirmationCode(sender, code, 'stop')) {
            return await this.reply(sock, from, msg, 
                '❌ Invalid or expired confirmation code.\n\n' +
                'Use `.security code stop` to generate a new code.');
        }

        // Execute PM2 stop
        await this.reply(sock, from, msg, 
            '🛑 *Stopping bot process...*\n\n' +
            'Goodbye! Use `pm2 start hambot` to restart.');

        // Give time for the message to send
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Try PM2 stop first, then fallback to process.exit
        try {
            const pm2Stop = spawn('pm2', ['stop', 'hambot'], {
                detached: true,
                stdio: 'ignore'
            });
            pm2Stop.unref();
        } catch (error) {
            // If PM2 fails, exit the process directly
            process.exit(0);
        }
    }

    async handleDisable(sock, from, msg, args) {
        const feature = args[0]?.toLowerCase();
        
        if (!feature) {
            return await this.reply(sock, from, msg, 
                '❌ Please specify a feature to disable.\n\n' +
                '*Available features:*\n' +
                '• `chatFilter` - Message content filtering\n' +
                '• `rateLimit` - Request rate limiting\n' +
                '• `autoBlock` - Automatic user blocking');
        }

        const validFeatures = ['chatFilter', 'rateLimit', 'autoBlock'];
        const normalizedFeature = validFeatures.find(f => f.toLowerCase() === feature);
        
        if (!normalizedFeature) {
            return await this.reply(sock, from, msg, 
                `❌ Unknown feature: ${feature}\n\n` +
                `Valid features: ${validFeatures.join(', ')}`);
        }

        const result = security.toggleFeature(normalizedFeature, false);
        
        await this.reply(sock, from, msg, 
            `⚙️ *Security Feature Updated*\n\n` +
            `Feature: ${normalizedFeature}\n` +
            `Status: ❌ DISABLED\n\n` +
            `⚠️ Warning: Disabling security features may expose the bot to abuse.`);
        await this.react(sock, msg, '✅');
    }

    async handleEnable(sock, from, msg, args) {
        const feature = args[0]?.toLowerCase();
        
        if (!feature) {
            return await this.reply(sock, from, msg, 
                '❌ Please specify a feature to enable.\n\n' +
                '*Available features:*\n' +
                '• `chatFilter` - Message content filtering\n' +
                '• `rateLimit` - Request rate limiting\n' +
                '• `autoBlock` - Automatic user blocking');
        }

        const validFeatures = ['chatFilter', 'rateLimit', 'autoBlock'];
        const normalizedFeature = validFeatures.find(f => f.toLowerCase() === feature);
        
        if (!normalizedFeature) {
            return await this.reply(sock, from, msg, 
                `❌ Unknown feature: ${feature}\n\n` +
                `Valid features: ${validFeatures.join(', ')}`);
        }

        const result = security.toggleFeature(normalizedFeature, true);
        
        await this.reply(sock, from, msg, 
            `⚙️ *Security Feature Updated*\n\n` +
            `Feature: ${normalizedFeature}\n` +
            `Status: ✅ ENABLED`);
        await this.react(sock, msg, '✅');
    }

    async handleUnblock(sock, from, msg, args) {
        const target = args[0]?.toLowerCase();
        
        if (!target) {
            return await this.reply(sock, from, msg, 
                '❌ Please specify a user to unblock.\n\n' +
                '*Usage:*\n' +
                '• `.security unblock 62812345678` - Unblock specific user\n' +
                '• `.security unblock all` - Unblock all users');
        }

        if (target === 'all') {
            const count = security.clearAllBlocks();
            await this.reply(sock, from, msg, 
                `✅ *All Users Unblocked*\n\n` +
                `Cleared ${count} blocked user(s).`);
            await this.react(sock, msg, '✅');
            return;
        }

        // Convert phone number to WhatsApp ID format
        const userId = target.includes('@') ? target : `${target}@s.whatsapp.net`;
        const success = security.unblockUser(userId);
        
        if (success) {
            await this.reply(sock, from, msg, 
                `✅ *User Unblocked*\n\n` +
                `User: ${target}`);
        } else {
            await this.reply(sock, from, msg, 
                `❌ User not found in block list: ${target}`);
        }
        await this.react(sock, msg, '✅');
    }

    async handleBlock(sock, from, msg, args) {
        const target = args[0];
        const minutes = parseInt(args[1]) || 60;
        
        if (!target) {
            return await this.reply(sock, from, msg, 
                '❌ Please specify a user to block.\n\n' +
                '*Usage:*\n' +
                '`.security block 62812345678 60` - Block for 60 minutes');
        }

        // Convert phone number to WhatsApp ID format
        const userId = target.includes('@') ? target : `${target}@s.whatsapp.net`;
        const durationMs = minutes * 60 * 1000;
        
        security.blockUser(userId, durationMs, 'Manually blocked by owner');
        
        await this.reply(sock, from, msg, 
            `⛔ *User Blocked*\n\n` +
            `User: ${target}\n` +
            `Duration: ${minutes} minutes\n` +
            `Reason: Manually blocked by owner`);
        await this.react(sock, msg, '✅');
    }

    async listBlockedUsers(sock, from, msg) {
        const blockedUsers = security.getBlockedUsers();
        
        if (blockedUsers.length === 0) {
            await this.reply(sock, from, msg, '✅ *No users are currently blocked.*');
            await this.react(sock, msg, '✅');
            return;
        }

        let response = `⛔ *BLOCKED USERS (${blockedUsers.length})*\n\n`;
        
        for (const user of blockedUsers.slice(0, 10)) {
            const minsLeft = Math.ceil(user.expiresIn / 1000 / 60);
            response += `• ${user.userIdShort}\n`;
            response += `  Reason: ${user.reason}\n`;
            response += `  Expires in: ${minsLeft} mins\n\n`;
        }

        if (blockedUsers.length > 10) {
            response += `... and ${blockedUsers.length - 10} more`;
        }

        await this.reply(sock, from, msg, response);
        await this.react(sock, msg, '✅');
    }

    async generateCode(sock, from, msg, args, sender) {
        const operation = args[0]?.toLowerCase();
        
        if (!operation) {
            return await this.reply(sock, from, msg, 
                '❌ Please specify an operation.\n\n' +
                '*Available operations:*\n' +
                '• `stop` - Generate code to stop bot process');
        }

        const validOperations = ['stop'];
        if (!validOperations.includes(operation)) {
            return await this.reply(sock, from, msg, 
                `❌ Unknown operation: ${operation}\n\n` +
                `Valid operations: ${validOperations.join(', ')}`);
        }

        const code = this.storeConfirmationCode(sender, operation);
        
        await this.reply(sock, from, msg, 
            `🔑 *Confirmation Code Generated*\n\n` +
            `Operation: ${operation}\n` +
            `Code: \`${code}\`\n\n` +
            `⏰ Expires in 60 seconds.\n\n` +
            `Use: \`.security ${operation} ${code}\``);
        await this.react(sock, msg, '✅');
    }
}

module.exports = SecurityCommand;
