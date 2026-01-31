/**
 * Social Media URL Parser
 * Comprehensive URL recognition and normalization for major social media platforms
 * Supports main URLs, short URLs, mobile URLs, and various URL formats
 */

/**
 * Platform definitions with all known URL patterns
 * Each platform has:
 * - name: Display name
 * - patterns: Array of regex patterns to match URLs
 * - normalizer: Optional function to normalize URL for yt-dlp
 */
const PLATFORMS = {
    // TikTok - Multiple URL formats
    tiktok: {
        name: 'TikTok',
        patterns: [
            // Main domain
            /^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+/i,
            /^https?:\/\/(www\.)?tiktok\.com\/t\/[\w]+/i,
            /^https?:\/\/(www\.)?tiktok\.com\/@[\w.-]+/i,
            // Short URL (vt.tiktok.com, vm.tiktok.com)
            /^https?:\/\/vt\.tiktok\.com\/[\w]+/i,
            /^https?:\/\/vm\.tiktok\.com\/[\w]+/i,
            // Mobile URLs
            /^https?:\/\/m\.tiktok\.com\//i,
            // Lite version
            /^https?:\/\/(www\.)?tiktok\.com\/lite\//i
        ],
        type: 'video'
    },

    // YouTube - All URL variations
    youtube: {
        name: 'YouTube',
        patterns: [
            // Standard watch URLs
            /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/i,
            /^https?:\/\/(www\.)?youtube\.com\/watch\?.*v=[\w-]+/i,
            // Short URLs
            /^https?:\/\/youtu\.be\/[\w-]+/i,
            // Shorts
            /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]+/i,
            // Live
            /^https?:\/\/(www\.)?youtube\.com\/live\/[\w-]+/i,
            // Embed
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[\w-]+/i,
            // Mobile
            /^https?:\/\/m\.youtube\.com\/watch\?v=[\w-]+/i,
            /^https?:\/\/m\.youtube\.com\/shorts\/[\w-]+/i,
            // Music
            /^https?:\/\/music\.youtube\.com\/watch\?v=[\w-]+/i,
            // Attribution link
            /^https?:\/\/(www\.)?youtube\.com\/attribution_link\?.*v%3D[\w-]+/i,
            // Clip
            /^https?:\/\/(www\.)?youtube\.com\/clip\/[\w-]+/i,
            // Playlist
            /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=[\w-]+/i,
            // Channel (for audio extraction from channel)
            /^https?:\/\/(www\.)?youtube\.com\/(c|channel|user)\/[\w-]+/i
        ],
        type: 'both' // Supports both video and audio
    },

    // Instagram - All URL formats
    instagram: {
        name: 'Instagram',
        patterns: [
            // Posts
            /^https?:\/\/(www\.)?instagram\.com\/p\/[\w-]+/i,
            // Reels
            /^https?:\/\/(www\.)?instagram\.com\/reel\/[\w-]+/i,
            /^https?:\/\/(www\.)?instagram\.com\/reels\/[\w-]+/i,
            // Stories (limited support)
            /^https?:\/\/(www\.)?instagram\.com\/stories\/[\w.-]+\/\d+/i,
            // TV/IGTV
            /^https?:\/\/(www\.)?instagram\.com\/tv\/[\w-]+/i,
            // Direct share links
            /^https?:\/\/instagr\.am\/p\/[\w-]+/i,
            // Profile videos
            /^https?:\/\/(www\.)?instagram\.com\/[\w.-]+\/reel\/[\w-]+/i
        ],
        type: 'video'
    },

    // Facebook - Complex URL structure
    facebook: {
        name: 'Facebook',
        patterns: [
            // Watch videos
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/watch\/?\?v=\d+/i,
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/watch\/live\/?\?v=\d+/i,
            // Reel URLs
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/reel\/\d+/i,
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/reels\/\d+/i,
            // Video URLs
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/[\w.-]+\/videos\/\d+/i,
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/video\.php\?v=\d+/i,
            // Short URLs
            /^https?:\/\/fb\.watch\/[\w-]+/i,
            /^https?:\/\/fb\.gg\/v\/[\w-]+/i,
            // Story
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/stories\/\d+/i,
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/[\w.-]+\/posts\/[\w-]+/i,
            // Share links
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/share\/(v|r)\/[\w-]+/i,
            // General video pattern
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/.*\/videos\//i,
            // Photo/video from feed
            /^https?:\/\/(www\.|web\.|m\.)?facebook\.com\/photo\/?(\?|\.php)/i
        ],
        type: 'video'
    },

    // Twitter/X - Both domains
    twitter: {
        name: 'Twitter/X',
        patterns: [
            // Twitter.com
            /^https?:\/\/(www\.)?twitter\.com\/[\w]+\/status\/\d+/i,
            /^https?:\/\/twitter\.com\/i\/status\/\d+/i,
            // X.com
            /^https?:\/\/(www\.)?x\.com\/[\w]+\/status\/\d+/i,
            /^https?:\/\/x\.com\/i\/status\/\d+/i,
            // Mobile
            /^https?:\/\/mobile\.twitter\.com\/[\w]+\/status\/\d+/i,
            /^https?:\/\/mobile\.x\.com\/[\w]+\/status\/\d+/i,
            // Short URLs (t.co redirects)
            /^https?:\/\/t\.co\/[\w]+/i
        ],
        type: 'video'
    },

    // Reddit
    reddit: {
        name: 'Reddit',
        patterns: [
            /^https?:\/\/(www\.)?reddit\.com\/r\/[\w]+\/comments\/[\w]+/i,
            /^https?:\/\/(www\.)?reddit\.com\/r\/[\w]+\/s\/[\w]+/i,
            /^https?:\/\/redd\.it\/[\w]+/i,
            /^https?:\/\/v\.redd\.it\/[\w]+/i,
            /^https?:\/\/(old|new)\.reddit\.com\/r\/[\w]+/i
        ],
        type: 'video'
    },

    // Twitch
    twitch: {
        name: 'Twitch',
        patterns: [
            /^https?:\/\/(www\.)?twitch\.tv\/[\w]+\/clip\/[\w-]+/i,
            /^https?:\/\/clips\.twitch\.tv\/[\w-]+/i,
            /^https?:\/\/(www\.)?twitch\.tv\/videos\/\d+/i,
            /^https?:\/\/(www\.)?twitch\.tv\/[\w]+\/video\/\d+/i
        ],
        type: 'video'
    },

    // Vimeo
    vimeo: {
        name: 'Vimeo',
        patterns: [
            /^https?:\/\/(www\.)?vimeo\.com\/\d+/i,
            /^https?:\/\/(www\.)?vimeo\.com\/[\w]+\/[\w]+/i,
            /^https?:\/\/player\.vimeo\.com\/video\/\d+/i
        ],
        type: 'video'
    },

    // Dailymotion
    dailymotion: {
        name: 'Dailymotion',
        patterns: [
            /^https?:\/\/(www\.)?dailymotion\.com\/video\/[\w]+/i,
            /^https?:\/\/dai\.ly\/[\w]+/i
        ],
        type: 'video'
    },

    // Pinterest (video pins)
    pinterest: {
        name: 'Pinterest',
        patterns: [
            /^https?:\/\/(www\.)?pinterest\.(com|co\.uk|de|fr)\/pin\/\d+/i,
            /^https?:\/\/pin\.it\/[\w]+/i
        ],
        type: 'video'
    },

    // LinkedIn
    linkedin: {
        name: 'LinkedIn',
        patterns: [
            /^https?:\/\/(www\.)?linkedin\.com\/posts\/[\w-]+/i,
            /^https?:\/\/(www\.)?linkedin\.com\/feed\/update\//i,
            /^https?:\/\/(www\.)?linkedin\.com\/video\//i
        ],
        type: 'video'
    },

    // Tumblr
    tumblr: {
        name: 'Tumblr',
        patterns: [
            /^https?:\/\/[\w-]+\.tumblr\.com\/post\/\d+/i,
            /^https?:\/\/(www\.)?tumblr\.com\/[\w-]+\/\d+/i
        ],
        type: 'video'
    },

    // Snapchat
    snapchat: {
        name: 'Snapchat',
        patterns: [
            /^https?:\/\/(www\.)?snapchat\.com\/spotlight\/[\w-]+/i,
            /^https?:\/\/story\.snapchat\.com\//i,
            /^https?:\/\/t\.snapchat\.com\/[\w]+/i
        ],
        type: 'video'
    },

    // SoundCloud (audio platform)
    soundcloud: {
        name: 'SoundCloud',
        patterns: [
            /^https?:\/\/(www\.)?soundcloud\.com\/[\w-]+\/[\w-]+/i,
            /^https?:\/\/soundcloud\.app\.goo\.gl\/[\w]+/i,
            /^https?:\/\/on\.soundcloud\.com\/[\w]+/i
        ],
        type: 'audio'
    },

    // Spotify
    spotify: {
        name: 'Spotify',
        patterns: [
            /^https?:\/\/open\.spotify\.com\/track\/[\w]+/i,
            /^https?:\/\/open\.spotify\.com\/episode\/[\w]+/i,
            /^https?:\/\/spotify\.link\/[\w]+/i
        ],
        type: 'audio'
    },

    // Bilibili
    bilibili: {
        name: 'Bilibili',
        patterns: [
            /^https?:\/\/(www\.)?bilibili\.com\/video\/[\w]+/i,
            /^https?:\/\/b23\.tv\/[\w]+/i,
            /^https?:\/\/m\.bilibili\.com\/video\/[\w]+/i
        ],
        type: 'video'
    },

    // VK
    vk: {
        name: 'VK',
        patterns: [
            /^https?:\/\/(www\.)?vk\.com\/video[\d-]+_\d+/i,
            /^https?:\/\/(www\.)?vk\.com\/clips[\d-]+/i,
            /^https?:\/\/vk\.cc\/[\w]+/i
        ],
        type: 'video'
    },

    // Douyin (Chinese TikTok)
    douyin: {
        name: 'Douyin',
        patterns: [
            /^https?:\/\/(www\.)?douyin\.com\/video\/\d+/i,
            /^https?:\/\/v\.douyin\.com\/[\w]+/i
        ],
        type: 'video'
    },

    // Weibo
    weibo: {
        name: 'Weibo',
        patterns: [
            /^https?:\/\/(www\.)?weibo\.com\/tv\/show\/\d+/i,
            /^https?:\/\/m\.weibo\.cn\/status\/[\w]+/i
        ],
        type: 'video'
    },

    // Likee
    likee: {
        name: 'Likee',
        patterns: [
            /^https?:\/\/(www\.)?likee\.video\/@[\w]+\/video\/\d+/i,
            /^https?:\/\/l\.likee\.video\/v\/[\w]+/i
        ],
        type: 'video'
    },

    // Loom
    loom: {
        name: 'Loom',
        patterns: [
            /^https?:\/\/(www\.)?loom\.com\/share\/[\w]+/i
        ],
        type: 'video'
    },

    // Streamable
    streamable: {
        name: 'Streamable',
        patterns: [
            /^https?:\/\/(www\.)?streamable\.com\/[\w]+/i
        ],
        type: 'video'
    },

    // Bandcamp
    bandcamp: {
        name: 'Bandcamp',
        patterns: [
            /^https?:\/\/[\w-]+\.bandcamp\.com\/track\/[\w-]+/i,
            /^https?:\/\/[\w-]+\.bandcamp\.com\/album\/[\w-]+/i
        ],
        type: 'audio'
    },

    // Mixcloud
    mixcloud: {
        name: 'Mixcloud',
        patterns: [
            /^https?:\/\/(www\.)?mixcloud\.com\/[\w-]+\/[\w-]+/i
        ],
        type: 'audio'
    },

    // Threads (Meta)
    threads: {
        name: 'Threads',
        patterns: [
            /^https?:\/\/(www\.)?threads\.net\/@[\w.]+\/post\/[\w]+/i,
            /^https?:\/\/(www\.)?threads\.net\/t\/[\w]+/i
        ],
        type: 'video'
    },

    // Kick
    kick: {
        name: 'Kick',
        patterns: [
            /^https?:\/\/(www\.)?kick\.com\/[\w]+\?clip=[\w-]+/i,
            /^https?:\/\/(www\.)?kick\.com\/[\w]+\/clips\/[\w-]+/i
        ],
        type: 'video'
    },

    // Rumble
    rumble: {
        name: 'Rumble',
        patterns: [
            /^https?:\/\/(www\.)?rumble\.com\/[\w-]+\.html/i,
            /^https?:\/\/rumble\.com\/embed\/[\w]+/i
        ],
        type: 'video'
    },

    // Odysee/LBRY
    odysee: {
        name: 'Odysee',
        patterns: [
            /^https?:\/\/(www\.)?odysee\.com\/@[\w-]+:[a-f0-9]+\/[\w-]+:[a-f0-9]+/i,
            /^https?:\/\/(www\.)?odysee\.com\/\$\/[\w]+/i
        ],
        type: 'video'
    },

    // Coub
    coub: {
        name: 'Coub',
        patterns: [
            /^https?:\/\/(www\.)?coub\.com\/view\/[\w]+/i
        ],
        type: 'video'
    },

    // TED
    ted: {
        name: 'TED',
        patterns: [
            /^https?:\/\/(www\.)?ted\.com\/talks\/[\w_]+/i
        ],
        type: 'video'
    },

    // Vevo
    vevo: {
        name: 'Vevo',
        patterns: [
            /^https?:\/\/(www\.)?vevo\.com\/watch\/[\w-]+/i
        ],
        type: 'video'
    },

    // Imgur
    imgur: {
        name: 'Imgur',
        patterns: [
            /^https?:\/\/(www\.|i\.)?imgur\.com\/(a\/)?[\w]+/i
        ],
        type: 'video'
    },

    // Gfycat
    gfycat: {
        name: 'Gfycat',
        patterns: [
            /^https?:\/\/(www\.)?gfycat\.com\/[\w]+/i
        ],
        type: 'video'
    }
};

/**
 * Parse and identify a URL's platform
 * @param {string} url - The URL to parse
 * @returns {Object|null} - Platform info or null if not recognized
 */
function identifyPlatform(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }

    // Clean the URL
    const cleanUrl = url.trim();

    for (const [key, platform] of Object.entries(PLATFORMS)) {
        for (const pattern of platform.patterns) {
            if (pattern.test(cleanUrl)) {
                return {
                    platform: key,
                    name: platform.name,
                    type: platform.type,
                    url: cleanUrl,
                    isShortUrl: isShortUrl(cleanUrl)
                };
            }
        }
    }

    return null;
}

/**
 * Check if URL is a shortened URL that needs resolution
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isShortUrl(url) {
    const shortUrlPatterns = [
        /^https?:\/\/vt\.tiktok\.com\//i,
        /^https?:\/\/vm\.tiktok\.com\//i,
        /^https?:\/\/youtu\.be\//i,
        /^https?:\/\/fb\.watch\//i,
        /^https?:\/\/fb\.gg\//i,
        /^https?:\/\/t\.co\//i,
        /^https?:\/\/redd\.it\//i,
        /^https?:\/\/v\.redd\.it\//i,
        /^https?:\/\/dai\.ly\//i,
        /^https?:\/\/pin\.it\//i,
        /^https?:\/\/instagr\.am\//i,
        /^https?:\/\/b23\.tv\//i,
        /^https?:\/\/vk\.cc\//i,
        /^https?:\/\/v\.douyin\.com\//i,
        /^https?:\/\/l\.likee\.video\//i,
        /^https?:\/\/on\.soundcloud\.com\//i,
        /^https?:\/\/soundcloud\.app\.goo\.gl\//i,
        /^https?:\/\/spotify\.link\//i,
        /^https?:\/\/t\.snapchat\.com\//i
    ];

    return shortUrlPatterns.some(pattern => pattern.test(url));
}

/**
 * Check if URL is supported for video download
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isVideoSupported(url) {
    const platform = identifyPlatform(url);
    if (!platform) return false;
    return platform.type === 'video' || platform.type === 'both';
}

/**
 * Check if URL is supported for audio extraction
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isAudioSupported(url) {
    const platform = identifyPlatform(url);
    if (!platform) return false;
    return platform.type === 'audio' || platform.type === 'both';
}

/**
 * Check if URL is a valid supported URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isSupportedUrl(url) {
    return identifyPlatform(url) !== null;
}

/**
 * Get platform-specific yt-dlp arguments
 * @param {string} url - The URL
 * @returns {string[]} - Additional yt-dlp arguments
 */
function getPlatformArgs(url) {
    const platform = identifyPlatform(url);
    if (!platform) return [];

    const args = [];

    switch (platform.platform) {
        case 'youtube':
            // Use android client for better compatibility
            args.push('--extractor-args', 'youtube:player_client=android');
            break;
        case 'tiktok':
            // TikTok often needs special handling
            args.push('--extractor-args', 'tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com');
            break;
        case 'instagram':
            // Instagram may need cookies in some cases
            break;
        case 'facebook':
            // Facebook often needs special handling
            break;
        case 'twitter':
            // Twitter/X compatibility
            break;
    }

    return args;
}

/**
 * Get friendly platform name for display
 * @param {string} url - The URL
 * @returns {string} - Human-readable platform name
 */
function getPlatformName(url) {
    const platform = identifyPlatform(url);
    return platform ? platform.name : 'Unknown';
}

/**
 * Get list of all supported platforms
 * @returns {Object} - Object with platform names and types
 */
function getSupportedPlatforms() {
    const result = {
        video: [],
        audio: [],
        both: []
    };

    for (const [key, platform] of Object.entries(PLATFORMS)) {
        result[platform.type].push({
            id: key,
            name: platform.name
        });
    }

    return result;
}

/**
 * Get supported platforms as formatted string for display
 * @returns {string}
 */
function getSupportedPlatformsText() {
    const platforms = getSupportedPlatforms();
    
    const videoList = [...platforms.video, ...platforms.both]
        .map(p => p.name)
        .sort()
        .join(', ');
    
    const audioList = [...platforms.audio, ...platforms.both]
        .map(p => p.name)
        .sort()
        .join(', ');

    return {
        video: videoList,
        audio: audioList
    };
}

module.exports = {
    identifyPlatform,
    isShortUrl,
    isVideoSupported,
    isAudioSupported,
    isSupportedUrl,
    getPlatformArgs,
    getPlatformName,
    getSupportedPlatforms,
    getSupportedPlatformsText,
    PLATFORMS
};
