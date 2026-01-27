/**
 * Menu Command
 * Display comprehensive bot help and command list
 */

const CommandBase = require('./base');
const commandRegistry = require('./registry');
const config = require('../config');

class MenuCommand extends CommandBase {
    constructor() {
        super({
            name: 'menu',
            aliases: ['help', 'intro', 'commands'],
            description: 'Display bot help and command list',
            usage: '.menu [category]',
            category: 'general',
            cooldown: 3000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        await this.react(sock, msg, '📋');

        // If category specified
        if (args[0]) {
            return await this.sendCategoryHelp(sock, from, msg, args[0]);
        }

        // Generate full menu
        const categories = commandRegistry.getCategories();
        const menuSections = [];

        menuSections.push(`🤖 *${config.bot.name}* 🤖`);
        menuSections.push(`_Welcome! Here are all available commands._\n`);

        for (const category of categories.sort()) {
            const commands = commandRegistry.getByCategory(category);
            if (commands.length === 0) continue;

            menuSections.push(`*${this.getCategoryEmoji(category)} ${category.toUpperCase()}*`);
            
            for (const cmd of commands) {
                const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : '';
                menuSections.push(`• *${config.bot.prefix}${cmd.name}${aliases}*`);
                if (cmd.description) {
                    menuSections.push(`  _${cmd.description}_`);
                }
                if (cmd.usage) {
                    menuSections.push(`  Usage: ${cmd.usage}`);
                }
                menuSections.push('');
            }
        }

        menuSections.push(`_Tip: Use ${config.bot.prefix}menu <category> for category details_`);
        menuSections.push(`© 2025 ${config.bot.owner}`);

        const menuText = menuSections.join('\n');
        await this.reply(sock, from, msg, menuText);
        await this.react(sock, msg, '✅');
    }

    async sendCategoryHelp(sock, from, msg, category) {
        const commands = commandRegistry.getByCategory(category.toLowerCase());
        
        if (commands.length === 0) {
            return await this.reply(sock, from, msg, `❌ Category "${category}" not found.`);
        }

        const sections = [];
        sections.push(`*${this.getCategoryEmoji(category)} ${category.toUpperCase()} COMMANDS*\n`);

        for (const cmd of commands) {
            sections.push(`*${config.bot.prefix}${cmd.name}*`);
            if (cmd.description) sections.push(`${cmd.description}`);
            if (cmd.usage) sections.push(`Usage: ${cmd.usage}`);
            if (cmd.aliases.length > 0) sections.push(`Aliases: ${cmd.aliases.join(', ')}`);
            sections.push('');
        }

        await this.reply(sock, from, msg, sections.join('\n'));
    }

    getCategoryEmoji(category) {
        const emojis = {
            'system': '⚙️',
            'general': '📋',
            'media': '🎵',
            'tools': '🛠️',
            'info': 'ℹ️',
            'entertainment': '🎬',
            'group': '👥',
            'fun': '🎉'
        };
        return emojis[category.toLowerCase()] || '📌';
    }
}

module.exports = MenuCommand;
