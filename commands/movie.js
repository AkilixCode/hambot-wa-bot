/**
 * Movie Command
 * Get movie information from OMDb
 */

const CommandBase = require('./base');
const httpClient = require('../utils/http-client');
const cache = require('../utils/cache');
const { fungsiTranslate, smartSearchIMDb, getValidPosterUrl } = require('../utils/helpers');
const config = require('../config');
const logger = require('../utils/logger');

class MovieCommand extends CommandBase {
    constructor() {
        super({
            name: 'movie',
            aliases: ['film', 'imdb'],
            description: 'Get movie information, ratings, and synopsis',
            usage: '.movie <movie title>',
            category: 'entertainment',
            cooldown: 4000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.reply(sock, from, msg, '🎬 Which movie?\n\nExample: .movie Interstellar');
        }

        if (!config.apis.omdb.key) {
            return await this.reply(sock, from, msg, '❌ OMDb API key not configured.\nGet one from: http://www.omdbapi.com/apikey.aspx');
        }

        await this.react(sock, msg, '🎬');

        const query = args.join(' ');
        const cacheKey = `movie:${query.toLowerCase()}`;

        // Check cache
        const cached = cache.get(cacheKey);
        if (cached) {
            return await this.sendMovieInfo(sock, from, msg, cached, true);
        }

        try {
            // Try smart IMDb search first
            const imdbId = await smartSearchIMDb(query);
            
            const url = imdbId 
                ? `http://www.omdbapi.com/?i=${imdbId}&apikey=${config.apis.omdb.key}&plot=full`
                : `http://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${config.apis.omdb.key}&plot=full`;

            // OMDb API with proxy support
            logger.info(`Movie: searching "${query}"`);
            const { data } = await httpClient.get(url, { timeout: 10000 });

            if (data.Response === 'False') {
                return await this.reply(sock, from, msg, `❌ Movie not found: "${query}"\n\nTry a different title or year.`);
            }

            logger.info(`Movie: found "${data.Title}"`);

            // Cache for 1 hour
            cache.set(cacheKey, data, 3600000);

            await this.sendMovieInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to fetch movie information.');
        }
    }

    async sendMovieInfo(sock, from, msg, data, fromCache) {
        try {
            // Get valid poster URL
            const poster = await getValidPosterUrl(data.Poster);

            // Translate synopsis
            const synopsis = await fungsiTranslate(data.Plot, 'id');

            const info = 
`🎬 *${data.Title}* (${data.Year})

⭐ Rating: ${data.imdbRating}/10 (${data.imdbVotes} votes)
🎭 Genre: ${data.Genre}
⏱️ Duration: ${data.Runtime}
🎬 Director: ${data.Director}
🎭 Cast: ${data.Actors}
🏆 Awards: ${data.Awards}

📝 *Synopsis:*
${synopsis}

${fromCache ? '📦 (from cache)' : ''}`;

            await sock.sendMessage(from, {
                image: { url: poster },
                caption: info
            }, { quoted: msg });

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, { context: 'send-movie-info' });
            throw error;
        }
    }
}

module.exports = MovieCommand;
