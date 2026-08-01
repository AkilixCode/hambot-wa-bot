# GitHub Copilot Instructions for HamBot WhatsApp Bot

## Project Context

This is a WhatsApp Bot built on top of the `@whiskeysockets/baileys` library, using a modular command structure with security features, rate limiting, and performance optimizations.

## Architecture Overview

### Entry Point
- **`index.js`**: Main entry point that initializes the WhatsApp socket connection
- **`handler.js`**: Message handler that processes incoming messages, applies security checks, and routes to commands

### Command System
- **Commands Directory**: `commands/` - Contains all bot commands as individual modules
- **Base Class**: `commands/base.js` - Abstract base class that all commands extend
- **Registry**: `commands/registry.js` - Dynamically loads and manages command modules

### Utilities
- **`utils/`**: Helper functions and shared utilities
  - `logger.js`: Centralized logging
  - `security.js`: Security validation and blocking
  - `rate-limiter.js`: Rate limiting for commands
  - `cache.js`: Caching layer for performance
  - `helpers.js`: General utility functions

### Configuration
- **`config.js`**: Centralized configuration management with validation
- **`.env`**: Environment variables (not committed to repo)

## Coding Standards

### 1. Command Structure

All commands **must** extend the `CommandBase` class and follow this structure:

```javascript
/**
 * Command Name
 * Brief description of what the command does
 */

const CommandBase = require('./base');

class CommandNameCommand extends CommandBase {
    constructor() {
        super({
            name: 'commandname',           // Primary command name
            aliases: ['alias1', 'alias2'], // Alternative command names
            description: 'What this command does',
            usage: '.commandname <args>',  // How to use it
            category: 'category',          // Category (system, media, fun, etc.)
            cooldown: 3000,                // Cooldown in milliseconds
            isHeavy: false,                // true for resource-intensive commands
            requiresGroup: false,          // true if only for group chats
            requiresAdmin: false,          // true if admin only
            requiresMedia: false           // true if requires image/media
        });
    }

    /**
     * Execute the command
     * @param {import('@whiskeysockets/baileys').WASocket} sock - WhatsApp socket
     * @param {Object} msg - Message object from Baileys
     * @param {string[]} args - Command arguments
     * @param {Object} context - Execution context (from, sender, isGroup, etc.)
     */
    async execute(sock, msg, args, context) {
        const { from } = context;
        
        try {
            // Your command logic here
            await this.react(sock, msg, '⏳');
            
            // ... command implementation ...
            
            await this.react(sock, msg, '✅');
            
        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Command failed.');
        }
    }
}

module.exports = CommandNameCommand;
```

**Required Exports:**
- Class extending `CommandBase`
- Constructor with command metadata
- `execute(sock, msg, args, context)` method

### 2. Error Handling

**ALWAYS** wrap command execution logic in try-catch blocks:

```javascript
async execute(sock, msg, args, context) {
    const { from } = context;
    
    try {
        // Command logic
        
    } catch (error) {
        this.logError(error, context);
        await this.reply(sock, from, msg, '❌ An error occurred.');
    }
}
```

**Do NOT:**
- Let errors propagate uncaught
- Use `console.error()` directly (use `this.logError()` or `logger.error()`)

### 3. External Calls and Heavy Operations

For external processes like Python scripts, `yt-dlp`, or other heavy tasks:

**Use `child_process` with proper helper functions:**

```javascript
const { spawnPromise, generateFilename, cleanupFiles } = require('../utils/helpers');
const config = require('../config');

// Mark command as heavy
constructor() {
    super({
        // ...
        isHeavy: true  // Important for queue management
    });
}

async execute(sock, msg, args, context) {
    const filePrefix = generateFilename('prefix', '');
    
    try {
        // Your heavy operation
        const result = await spawnPromise('command', ['args']);
        
    } catch (error) {
        // Error handling
    } finally {
        // Always cleanup temporary files
        await cleanupFiles(filePrefix);
    }
}
```

### 4. Using yt-dlp

**CRITICAL**: go through `utils/ytdlp.js`. Never call `spawn`/`spawnPromise`
with yt-dlp directly, and never build proxy arguments by hand.

```javascript
const ytdlp = require('../utils/ytdlp');
const tempdir = require('../utils/tempdir');

// Metadata — returns parsed JSON objects, one per output line
const [info] = await ytdlp.getInfo(url, { extraArgs: ytdlp.getYouTubeArgs() });

// Download — always into tmp/, never the working directory
const outputTemplate = tempdir.tempPath(`${filePrefix}.%(ext)s`);
await ytdlp.download(url, outputTemplate, ['-x', '--audio-format', 'mp3'], {
    maxFilesize: config.media.maxFileSize,
    extraArgs: ytdlp.getYouTubeArgs()
});
```

**Why the wrapper exists:**
- **Timeouts.** It kills a hung process (SIGTERM, then SIGKILL). Without this a
  stuck download holds one of only three heavy-command slots forever.
- **Proxy handling**, including retrying directly when the proxy itself is
  unreachable — but *not* on a bot check, where falling back to the datacenter
  IP is strictly worse.
- **`ytdlp.getYouTubeArgs()`** supplies the player clients and PO token args.
  Player clients come from `YTDLP_PLAYER_CLIENTS` because YouTube retires them
  every few months. **Never hardcode `player_client=` in a command** — the old
  hardcoded `android` is deprecated and was a likely cause of failures.

Media commands should also use the provider cascade so a blocked source falls
through to a working one rather than failing outright — see `utils/providers.js`
and `docs/MEDIA.md`.

### 5. JSDoc Type Annotations

**ALWAYS** use JSDoc to annotate parameters for better type inference and IDE support:

```javascript
/**
 * Execute the command
 * @param {import('@whiskeysockets/baileys').WASocket} sock - WhatsApp socket instance
 * @param {Object} msg - Message object from Baileys
 * @param {string[]} args - Command arguments parsed from message
 * @param {Object} context - Execution context
 * @param {string} context.from - Chat JID
 * @param {string} context.sender - Sender JID
 * @param {boolean} context.isGroup - Whether this is a group chat
 * @param {string} context.commandName - Command name used
 * @param {number} context.startTime - Execution start timestamp
 */
async execute(sock, msg, args, context) {
    // Implementation
}
```

### 6. Helper Methods from CommandBase

Available methods from the base class:

```javascript
// Send a reply message
await this.reply(sock, from, msg, 'Your message');

// React to a message with an emoji
await this.react(sock, msg, '✅');

// Log command execution
this.log(context, duration, success);

// Log errors
this.logError(error, context);
```

### 7. Accessing Configuration

Use the centralized config module:

```javascript
const config = require('../config');

// Bot configuration
config.bot.name          // Bot name
config.bot.prefix        // Command prefix (e.g., '.')
config.bot.owner         // Bot owner name

// Performance settings
config.performance.maxProcesses      // Max concurrent heavy commands
config.performance.cooldownMs        // Default cooldown
config.performance.rateLimitMax      // Rate limit threshold

// Media settings
config.media.maxDuration   // Max media duration in seconds
config.media.maxFileSize   // Max size, yt-dlp form ('64M') — for --max-filesize
config.media.maxFileBytes  // Max size in bytes — for the post-download check

// Proxy: do NOT read these directly in a command. utils/ytdlp.js and
// utils/http-client.js already apply them, and the live toggle in
// utils/egress.js drives config.proxy.enabled for every consumer at once.

// API keys
config.apis.elevenlabs.key    // ElevenLabs API key
config.apis.omdb.key          // OMDB API key
```

### 8. File Operations and Cleanup

**ALWAYS** clean up temporary files:

Temp files go in `tmp/` via `utils/tempdir.js` — **never** the working
directory, which is the repo root.

```javascript
const { generateFilename } = require('../utils/helpers');
const tempdir = require('../utils/tempdir');

async execute(sock, msg, args, context) {
    const filePrefix = generateFilename('music', '');

    try {
        // tempPath() resolves inside tmp/ and rejects path traversal
        const outputPath = tempdir.tempPath(`${filePrefix}.mp3`);

        // ... your operations ...

    } catch (error) {
        // Error handling
    } finally {
        // ALWAYS cleanup, even on error. Scoped to tmp/, so a bad prefix
        // cannot touch project files.
        await tempdir.cleanupTemp(filePrefix);
    }
}
```

For large media, hand Baileys the **path** rather than a Buffer — it streams
from disk, so the file never has to sit in the heap:

```javascript
await this.replyMedia(sock, from, msg, {
    audio: { url: filePath },
    mimetype: 'audio/mpeg'
});
```

### 9. Validation and User Feedback

Validate input before processing:

```javascript
async execute(sock, msg, args, context) {
    const { from } = context;
    
    // Validate required arguments
    if (!args[0]) {
        return await this.reply(sock, from, msg, 
            '❌ Missing argument!\n\nUsage: .command <arg>');
    }
    
    // Validate argument format
    if (!this.isValidFormat(args[0])) {
        return await this.reply(sock, from, msg, '❌ Invalid format!');
    }
    
    // Proceed with command
}
```

### 10. Sending Media

Use Baileys methods to send different media types:

```javascript
// Send audio
await sock.sendMessage(from, {
    audio: audioBuffer,
    mimetype: 'audio/mp4',
    caption: 'Caption text'
}, { quoted: msg });

// Send image
await sock.sendMessage(from, {
    image: imageBuffer,
    caption: 'Caption text'
}, { quoted: msg });

// Send sticker
await sock.sendMessage(from, {
    sticker: stickerBuffer
}, { quoted: msg });
```

## Best Practices

### Performance
- Mark resource-intensive commands with `isHeavy: true`
- Use appropriate cooldown times (minimum 2000ms)
- Clean up temporary files in `finally` blocks
- Use the cache utility for repeated API calls

### Security
- **Never** execute arbitrary user input directly
- Validate all arguments before processing
- Use the security utilities for input sanitization
- Check permissions for sensitive commands

### User Experience
- Use emojis for visual feedback (⏳ for processing, ✅ for success, ❌ for errors)
- Provide clear error messages
- Show usage examples in error messages
- React to messages to show processing status

### Code Organization
- One command per file
- Keep commands focused and single-purpose
- Extract complex logic to utility functions
- Use meaningful variable names

### Testing
- Test commands with various inputs
- Test error scenarios
- Verify cleanup of temporary files
- Check rate limiting behavior

## Common Patterns

### Media Download Pattern

```javascript
const { generateFilename } = require('../utils/helpers');
const ytdlp = require('../utils/ytdlp');
const media = require('../utils/media');
const tempdir = require('../utils/tempdir');
const config = require('../config');

async execute(sock, msg, args, context) {
    const { from } = context;
    const filePrefix = generateFilename('media', '');

    try {
        await this.react(sock, msg, '⏳');

        // Download. Proxy args, network args, timeouts and the proxy->direct
        // retry are all handled inside the runner.
        const outputTemplate = tempdir.tempPath(`${filePrefix}.%(ext)s`);
        await ytdlp.download(url, outputTemplate, ['-x', '--audio-format', 'mp3'], {
            maxFilesize: config.media.maxFileSize,
            extraArgs: ytdlp.getYouTubeArgs()
        });

        // Locate the result — yt-dlp chooses the container, so match on prefix
        const file = await media.findDownload(filePrefix, ['mp3', 'm4a']);
        if (!file) throw new Error('Download failed');

        if (!media.isWithinSizeLimit(file.size)) {
            return await this.replyError(sock, from, msg,
                `Filenya kegedean. Batasnya ${media.sizeLimitLabel()}.`,
                { title: 'File Kegedean' });
        }

        // Stream from disk rather than buffering the whole file
        await this.replyMedia(sock, from, msg, {
            audio: { url: file.path },
            mimetype: 'audio/mpeg'
        });
        await this.react(sock, msg, '✅');

    } catch (error) {
        this.logError(error, context);
        // Shared yt-dlp error -> Indonesian message mapping
        const d = media.describeError(error, 'musik');
        await this.replyError(sock, from, msg, d.reason, { title: d.title, hint: d.hint });
    } finally {
        await tempdir.cleanupTemp(filePrefix);
    }
}
```

### API Call Pattern

```javascript
const axios = require('axios');
const cache = require('../utils/cache');

async execute(sock, msg, args, context) {
    const { from } = context;
    const query = args.join(' ');
    
    // Check cache first
    const cacheKey = `api:${query}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return await this.reply(sock, from, msg, cached);
    }
    
    try {
        await this.react(sock, msg, '🔍');
        
        const response = await axios.get('https://api.example.com', {
            params: { q: query }
        });
        
        const result = response.data;
        
        // Cache result
        cache.set(cacheKey, result);
        
        await this.reply(sock, from, msg, result);
        await this.react(sock, msg, '✅');
        
    } catch (error) {
        this.logError(error, context);
        await this.reply(sock, from, msg, '❌ API request failed.');
    }
}
```

### Image Processing Pattern

```javascript
const sharp = require('sharp');

async execute(sock, msg, args, context) {
    const { from } = context;
    
    // Check for image
    const imageMessage = msg.message.imageMessage || 
                        msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    
    if (!imageMessage) {
        return await this.reply(sock, from, msg, '❌ Please send an image!');
    }
    
    try {
        await this.react(sock, msg, '⏳');
        
        // Download image
        const buffer = await sock.downloadMediaMessage(msg);
        
        // Process with sharp
        const processed = await sharp(buffer)
            .resize(512, 512)
            .toBuffer();
        
        // Send result
        await sock.sendMessage(from, { image: processed }, { quoted: msg });
        await this.react(sock, msg, '✅');
        
    } catch (error) {
        this.logError(error, context);
        await this.reply(sock, from, msg, '❌ Image processing failed.');
    }
}
```

## Common Pitfalls to Avoid

1. **❌ Calling yt-dlp directly** - Always go through `utils/ytdlp.js`; it owns
   proxy args, timeouts and player clients
1. **❌ Hardcoding `player_client=`** - Use `YTDLP_PLAYER_CLIENTS` in `.env`;
   YouTube retires clients every few months
1. **❌ Writing temp files to the working directory** - Use `utils/tempdir.js`
1. **❌ Passing `{ url }` to Baileys for remote media** - It fetches outside
   `utils/http-client`, bypassing the proxy. Fetch to a Buffer first.
2. **❌ Forgetting cleanup** - Always use `finally` blocks for file cleanup
3. **❌ Missing error handling** - Always wrap in try-catch
4. **❌ Direct console logging** - Use `logger` or `this.logError()`
5. **❌ Not marking heavy commands** - Set `isHeavy: true` for resource-intensive operations
6. **❌ Ignoring cooldowns** - Set appropriate cooldown times
7. **❌ Not using JSDoc** - Always annotate parameters for better IDE support
8. **❌ Blocking operations** - Use async/await properly
9. **❌ Memory leaks** - Clean up listeners, timers, and file handles
10. **❌ Unclear error messages** - Provide helpful feedback to users

## Dependencies

Key dependencies to be aware of:
- `@whiskeysockets/baileys` - WhatsApp Web API
- `sharp` - Image processing
- `axios` - HTTP requests
- `yt-dlp` - External tool for media downloads (not a Node package)

## Questions?

Refer to existing commands in the `commands/` directory for working examples:
- `ping.js` - Simple status command
- `music.js` - Heavy command with yt-dlp
- `sticker.js` - Media processing command
- `menu.js` - Command listing and help
