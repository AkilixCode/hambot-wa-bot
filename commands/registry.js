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
                // A silently overwritten alias means one command quietly steals
                // another's shortcut depending on directory read order — surface
                // it instead of letting it drift.
                const existing = this.aliases.get(alias);
                if (existing && existing !== command.name) {
                    logger.warn(
                        `Alias "${alias}" claimed by both "${existing}" and "${command.name}"; "${command.name}" wins`
                    );
                }
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
            // Underscore-prefixed files are scaffolding, not commands. Without
            // this, _template.js registered itself as a live `.template`
            // command and showed up in the public menu.
            if (file === 'base.js' || file === 'registry.js' ||
                file.startsWith('_') || !file.endsWith('.js')) {
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
     * Score how close a mistyped query is to a candidate name.
     *
     * Deliberately cheap — a shared-prefix count with a substring bonus. It
     * catches the cases that actually happen (`.vidio`, `.weater`, `.stiker`)
     * without pulling in a Levenshtein implementation for a chat bot.
     *
     * @param {string} query Lowercased user input
     * @param {string} candidate Lowercased candidate name
     * @returns {number} Higher is closer; 0 means "not a plausible typo"
     * @private
     */
    _similarity(query, candidate) {
        if (candidate === query) return 100;

        // Short aliases (`d`, `p`, `s`) are substrings of half the dictionary,
        // so a containment match on them is noise, not a suggestion. Require
        // both sides to be long enough for the overlap to mean something.
        const MIN_OVERLAP = 3;
        if (candidate.length >= MIN_OVERLAP && query.length >= MIN_OVERLAP) {
            if (candidate.startsWith(query) || query.startsWith(candidate)) return 50 + query.length;
            if (candidate.includes(query) || query.includes(candidate)) return 25;
        } else if (candidate.startsWith(query) || query.startsWith(candidate)) {
            // A short candidate still counts when the user typed a prefix of it.
            return 40 + query.length;
        }

        let shared = 0;
        while (shared < query.length && shared < candidate.length && query[shared] === candidate[shared]) {
            shared++;
        }
        return shared >= 3 ? shared : 0;
    }

    /**
     * Suggest command names close to what the user typed.
     *
     * @param {string} query Raw user input
     * @param {Object} [opts]
     * @param {number} [opts.limit] Maximum suggestions (default 3)
     * @param {string[]} [opts.extra] Extra candidates, e.g. category names
     * @param {function(string): boolean} [opts.filter] Keep only candidates that
     *   pass this test. Callers MUST use it to drop commands the requester is
     *   not allowed to see — otherwise a typo turns into a listing of the
     *   owner-only commands the menu deliberately hides.
     * @returns {string[]} Canonical names, closest first
     */
    suggest(query, { limit = 3, extra = [], filter } = {}) {
        if (!query || typeof query !== 'string') return [];
        const needle = query.toLowerCase();

        const candidates = new Set([...this.commands.keys(), ...this.aliases.keys(), ...extra]);

        const scored = [];
        for (const candidate of candidates) {
            const canonical = this.resolveName(candidate) || candidate;
            if (filter && !filter(canonical)) continue;

            const score = this._similarity(needle, candidate.toLowerCase());
            if (score > 0) scored.push({ name: canonical, score });
        }

        // Collapse aliases onto their canonical name, keeping the best score.
        const best = new Map();
        for (const { name, score } of scored) {
            if (!best.has(name) || best.get(name) < score) best.set(name, score);
        }

        return Array.from(best.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([name]) => name);
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
