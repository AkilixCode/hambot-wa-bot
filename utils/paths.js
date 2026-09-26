/**
 * Runtime Paths
 *
 * One definition of where the bot keeps state it writes at runtime (the
 * persisted proxy toggle, the login QR image, the health file). The Docker
 * image mounts a volume here, and the tests point HAMBOT_DATA_DIR at a temp
 * directory so they never touch a live bot's files.
 */

const path = require('path');

/**
 * @returns {string} Absolute path of the data directory
 */
function dataDir() {
    return process.env.HAMBOT_DATA_DIR
        ? path.resolve(process.env.HAMBOT_DATA_DIR)
        : path.join(__dirname, '..', 'data');
}

module.exports = { dataDir };
