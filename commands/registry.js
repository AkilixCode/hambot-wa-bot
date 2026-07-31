/**
 * Command Registry
 * Central registry for all bot commands
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Commands that can never be disabled at runtime. Without this, an owner could
// disable `security` and lose the only way to re-enable anything short of a
// full process restart.
const PROTECTED_COMMANDS = new Set(['security', 'menu']);

class CommandRegistry {
    constructor() {
        this.commands = new Map();
        this.aliases = new Map();
        // Canonical names of commands switched off at runtime by the owner
        this.disabled = new Set();
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
     * Resolve an alias to its canonical command name.
     * Permission checks must always run against the canonical name — checking
     * the raw user input lets an alias slip past an owner-only allowlist.
     *
     * @param {string} nameOrAlias
     * @returns {string|null} Canonical command name, or null if unknown
     */
    resolveName(nameOrAlias) {
        if (!nameOrAlias) return null;
        const key = String(nameOrAlias).toLowerCase();

        if (this.commands.has(key)) return key;
        if (this.aliases.has(key)) return this.aliases.get(key);

        return null;
    }

    /**
     * Turn a command off at runtime (owner control, not persisted).
     * @param {string} nameOrAlias
     * @returns {Object} { success: boolean, name?: string, reason?: string }
     */
    disable(nameOrAlias) {
        const name = this.resolveName(nameOrAlias);
        if (!name) {
            return { success: false, reason: 'Perintah tidak ditemukan' };
        }
        if (PROTECTED_COMMANDS.has(name)) {
            return { success: false, reason: 'Perintah ini dilindungi dan tidak dapat dinonaktifkan' };
        }

        this.disabled.add(name);
        return { success: true, name };
    }

    /**
     * Turn a previously disabled command back on.
     * @param {string} nameOrAlias
     * @returns {Object} { success: boolean, name?: string, reason?: string }
     */
    enable(nameOrAlias) {
        const name = this.resolveName(nameOrAlias);
        if (!name) {
            return { success: false, reason: 'Perintah tidak ditemukan' };
        }

        const wasDisabled = this.disabled.delete(name);
        return { success: true, name, wasDisabled };
    }

    /**
     * @param {string} nameOrAlias
     * @returns {boolean} Whether the command is currently disabled
     */
    isDisabled(nameOrAlias) {
        const name = this.resolveName(nameOrAlias);
        return name ? this.disabled.has(name) : false;
    }

    /**
     * @returns {string[]} Canonical names of all disabled commands
     */
    getDisabled() {
        return Array.from(this.disabled).sort();
    }

    /**
     * Re-enable every disabled command.
     * @returns {number} How many were re-enabled
     */
    enableAll() {
        const count = this.disabled.size;
        this.disabled.clear();
        return count;
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
