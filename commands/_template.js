/**
 * Template Command
 * Use this as a template for creating new commands
 * 
 * To create a new command:
 * 1. Copy this file and rename it (e.g., mycommand.js)
 * 2. Update the class name, command name, and metadata
 * 3. Implement your logic in the execute() method
 */

const CommandBase = require('./base');

class TemplateCommand extends CommandBase {
    constructor() {
        super({
            name: 'template',           // Command name (e.g., .template)
            aliases: ['alias1'],        // Alternative names for the command
            description: 'Template command description',
            usage: '.template <args>',
            category: 'general',        // Category for menu grouping
            cooldown: 3000,             // Cooldown in milliseconds
            isHeavy: false,             // Set to true for resource-intensive commands
            requiresGroup: false,       // Set to true if command is group-only
            requiresAdmin: false,       // Set to true if admin-only in groups
            requiresMedia: false        // Set to true if command requires image/video
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        // Check if arguments are provided (if required)
        if (!args[0]) {
            return await this.reply(sock, from, msg, 
                '📝 *Template Command*\n\n' +
                'Usage: .template <your text>\n\n' +
                'Example: .template Hello World'
            );
        }

        // Show loading reaction
        await this.react(sock, msg, '⏳');

        try {
            // Your command logic here
            const userInput = args.join(' ');
            
            // Send response
            await this.reply(sock, from, msg, `You said: ${userInput}`);
            
            // Show success reaction
            await this.react(sock, msg, '✅');

        } catch (error) {
            // Log the error
            this.logError(error, context);
            
            // Send error message to user
            await this.reply(sock, from, msg, '❌ An error occurred.');
        }
    }
}

module.exports = TemplateCommand;
