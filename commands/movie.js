/**
 * Movie Command
 * Get movie information from OMDb
 */

const CommandBase = require('./base');
const ui = require('../utils/ui');
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
            description: 'Info film, rating, dan sinopsis',
            usage: '.movie <movie title>',
            category: 'entertainment',
            cooldown: 4000
        });
    }

    async execute(sock, msg, args, context) {
        const { from } = context;

        if (!args[0]) {
            return await this.replyUsage(sock, from, msg, {
                icon: '🎬',
                title: 'Info Film',
                description: 'Cari rating, sinopsis, dan detail film.',
                usage: ['.movie <judul film>'],
                examples: ['.movie Interstellar', '.movie Laskar Pelangi', '.movie The Matrix']
            });
        }

        if (!config.apis.omdb.key) {
            return await this.replyError(sock, from, msg, 'Kunci API OMDb belum diatur di server.', {
                title: 'Belum Dikonfigurasi',
                hint: ['Hubungi owner bot untuk mengaktifkannya']
            });
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
            const titleUrl = `https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=${config.apis.omdb.key}&plot=full`;

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
                    return await this.replyError(sock, from, msg,
                        `Film ${ui.mono(ui.safe(query, 60))} tidak ditemukan.`, {
                            title: 'Film Tidak Ditemukan',
                            hint: [
                                'Pakai judul aslinya dalam bahasa Inggris',
                                'Sertakan tahun rilis, misal .movie Dune 2024',
                                'Periksa ejaan judulnya'
                            ]
                        });
                }

                const idUrl = `https://www.omdbapi.com/?i=${searchResult.id}&apikey=${config.apis.omdb.key}&plot=full`;
                logger.info(`Movie: retrying via ${searchResult.method}, IMDb ID "${searchResult.id}" for query "${query}"`);
                ({ data } = await httpClient.get(idUrl, { timeout: 10000 }));

                if (data.Response === 'False') {
                    logger.warn('Movie IMDb ID lookup also failed', {
                        query,
                        imdbId: searchResult.id,
                        method: searchResult.method,
                        omdbError: data.Error || 'Unknown error'
                    });
                    return await this.replyError(sock, from, msg,
                        `Film ${ui.mono(ui.safe(query, 60))} belum ada di basis data OMDb.`, {
                            title: 'Film Tidak Ditemukan',
                            hint: ['Coba judul lain', 'Coba lagi beberapa waktu kemudian']
                        });
                }
            }

            logger.info(`Movie: found "${data.Title}"`);

            // Cache for 1 hour
            cache.set(cacheKey, data, 3600000);

            await this.sendMovieInfo(sock, from, msg, data, false);

        } catch (error) {
            this.logError(error, context);
            await this.replyError(sock, from, msg, 'Gagal mengambil informasi film.', {
                hint: ['Coba lagi sebentar lagi']
            });
        }
    }

    async sendMovieInfo(sock, from, msg, data, fromCache) {
        try {
            // Get valid poster URL
            const poster = await getValidPosterUrl(data.Poster);

            // Translate synopsis
            const synopsis = await fungsiTranslate(data.Plot, 'id');

            const info = ui.card({
                icon: '🎬',
                title: `${data.Title} (${data.Year})`,
                lines: [
                    ui.kv('Rating', `${data.imdbRating}/10 (${data.imdbVotes} suara)`, '⭐'),
                    ui.kv('Genre', data.Genre, '🎭'),
                    ui.kv('Durasi', data.Runtime, '⏱️'),
                    ui.kv('Sutradara', data.Director, '🎬'),
                    ui.kv('Pemeran', ui.truncate(data.Actors, 120), '👥'),
                    data.Awards && data.Awards !== 'N/A' ? ui.kv('Penghargaan', ui.truncate(data.Awards, 90), '🏆') : null,
                    '',
                    `📝 ${ui.bold('Sinopsis')}`,
                    ui.truncate(synopsis, 600)
                ],
                footer: `${ui.sourceBadge(fromCache)} ${ui.SYM.dot} OMDb`
            });

            if (poster) {
                // Via replyMedia so the caption gets clamped to WhatsApp's 1024-char
                // limit — a long synopsis plus a full metadata card can exceed it.
                await this.replyMedia(sock, from, msg, {
                    image: { url: poster },
                    caption: info
                });
            } else {
                // No poster on OMDb: send the card on its own rather than
                // failing the whole lookup over a missing picture.
                await this.reply(sock, from, msg, info);
            }

            await this.react(sock, msg, '✅');

        } catch (error) {
            this.logError(error, { context: 'send-movie-info' });
            throw error;
        }
    }
}

module.exports = MovieCommand;
