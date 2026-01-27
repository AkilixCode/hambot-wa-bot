/**
 * Command Registry
 * Central registry for all bot commands
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class CommandRegistry {
    constructor() {
        this.commands = new Map();
        this.aliases = new Map();
    }

    /**
     * Register a command
     */
    register(command) {
        if (!command.name) {
            throw new Error('Command must have a name');
        }

        this.commands.set(command.name, command);

        // Register aliases
        if (command.aliases && Array.isArray(command.aliases)) {
            for (const alias of command.aliases) {
                this.aliases.set(alias, command.name);
            }
        }

        logger.debug(`Registered command: ${command.name}`);
    }

    /**
     * Get command by name or alias
     */
    get(nameOrAlias) {
        // Try direct lookup
        if (this.commands.has(nameOrAlias)) {
            return this.commands.get(nameOrAlias);
        }

        // Try alias lookup
        if (this.aliases.has(nameOrAlias)) {
            const commandName = this.aliases.get(nameOrAlias);
            return this.commands.get(commandName);
        }

        return null;
    }

    /**
     * Check if command exists
     */
    has(nameOrAlias) {
        return this.commands.has(nameOrAlias) || this.aliases.has(nameOrAlias);
    }

    /**
     * Load all commands from directory
     */
    loadFromDirectory(dirPath) {
        const files = fs.readdirSync(dirPath);
        let loaded = 0;

        for (const file of files) {
            if (file === 'base.js' || file === 'registry.js' || !file.endsWith('.js')) {
                continue;
            }

            try {
                const filePath = path.join(dirPath, file);
                const CommandClass = require(filePath);
                const command = new CommandClass();
                this.register(command);
                loaded++;
            } catch (error) {
                logger.error(error, { file, context: 'command-loading' });
            }
        }

        logger.info(`Loaded ${loaded} commands`);
        return loaded;
    }

    /**
     * Get all commands
     */
    getAll() {
        return Array.from(this.commands.values());
    }

    /**
     * Get commands by category
     */
    getByCategory(category) {
        return this.getAll().filter(cmd => cmd.category === category);
    }

    /**
     * Get all categories
     */
    getCategories() {
        const categories = new Set();
        for (const command of this.commands.values()) {
            categories.add(command.category);
        }
        return Array.from(categories);
    }
}

module.exports = new CommandRegistry();
