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

                const imdbId = await smartSearchIMDb(query);
                if (!imdbId) {
                    logger.warn('IMDb ID fallback failed: no IMDb ID found', { query });
                    return await this.reply(
                        sock,
                        from,
                        msg,
                        `❌ Movie not found for "${query}".\n\nTried:\n• OMDb title search\n• IMDb ID fallback search\n\nPlease try a more specific title (or include year).`
                    );
                }

                const idUrl = `http://www.omdbapi.com/?i=${imdbId}&apikey=${config.apis.omdb.key}&plot=full`;
                logger.info(`Movie: searching by IMDb ID "${imdbId}" for query "${query}"`);
                ({ data } = await httpClient.get(idUrl, { timeout: 10000 }));

                if (data.Response === 'False') {
                    logger.warn('Movie IMDb ID lookup also failed', {
                        query,
                        imdbId,
                        omdbError: data.Error || 'Unknown error'
                    });
                    return await this.reply(
                        sock,
                        from,
                        msg,
                        `❌ Movie not found for "${query}".\n\nTried:\n• OMDb title search\n• OMDb IMDb-ID search (${imdbId})\n\nPlease try another title or add release year.`
                    );
                }
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
