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
            const titleUrl = `http://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${config.apis.omdb.key}&plot=full`;

            // 1) Search by title first
            logger.info(`Movie: searching by title "${query}"`);
            let { data } = await httpClient.get(titleUrl, { timeout: 10000 });

            // 2) Fallback to IMDb ID search when title lookup fails
            if (data.Response === 'False') {
                logger.warn('Movie title search failed, trying IMDb ID fallback', {
                    query,
                    omdbError: data.Error || 'Unknown error'
                });

                const searchResult = await smartSearchIMDb(query, config.apis.omdb.key);

                if (!searchResult.id) {
                    logger.warn('IMDb ID fallback failed: no IMDb ID found', {
                        query,
                        strategiesTried: 'imdb-suggest, omdb-search, duckduckgo'
                    });
                    return await this.reply(
                        sock,
                        from,
                        msg,
                        `❌ Movie not found: "${query}"\n\n` +
                        `Tried:\n` +
                        `• OMDb title search → ${data.Error || 'Not found'}\n` +
                        `• IMDb ID lookup (3 strategies) → No results\n\n` +
                        `💡 Tips:\n` +
                        `• Try the exact English title\n` +
                        `• Include the release year, e.g. ".movie The Odyssey 2025"\n` +
                        `• Check for typos in the title`
                    );
                }

                const idUrl = `http://www.omdbapi.com/?i=${searchResult.id}&apikey=${config.apis.omdb.key}&plot=full`;
                logger.info(`Movie: retrying via ${searchResult.method}, IMDb ID "${searchResult.id}" for query "${query}"`);
                ({ data } = await httpClient.get(idUrl, { timeout: 10000 }));

                if (data.Response === 'False') {
                    logger.warn('Movie IMDb ID lookup also failed', {
                        query,
                        imdbId: searchResult.id,
                        method: searchResult.method,
                        omdbError: data.Error || 'Unknown error'
                    });
                    return await this.reply(
                        sock,
                        from,
                        msg,
                        `❌ Movie not found: "${query}"\n\n` +
                        `Tried:\n` +
                        `• OMDb title search → Not found\n` +
                        `• OMDb ID search (${searchResult.id} via ${searchResult.method}) → ${data.Error || 'Not found'}\n\n` +
                        `💡 The movie may not yet be in OMDb's database.\n` +
                        `Try again later or use a different title.`
                    );
                }
            }

            logger.info(`Movie: found "${data.Title}"`);

            // Cache for 1 hour
            cache.set(cacheKey, data, 3600000);

            await this.sendMovieInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            await this.reply(sock, from, msg, '❌ Failed to fetch movie information. Please try again later.');
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
