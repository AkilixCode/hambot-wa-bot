/**
 * A stand-in app for the shutdown tests: utils/shutdown wired exactly as
 * index.js wires it, with one step that records it ran. Started directly
 * (signals) or under real pm2 (tests/pm2-stop.test.cjs).
 *
 *   SHUTDOWN_MARKER  file the cleanup step writes "shutdown complete" to
 */

const fs = require('fs');
const path = require('path');
const shutdownLib = require(path.join(__dirname, '..', '..', 'utils', 'shutdown'));

const marker = process.env.SHUTDOWN_MARKER;

const shutdown = shutdownLib.create({
    log: (message) => console.log(message),
    steps: [
        {
            name: 'write marker',
            run: () => shutdown.track(fs.promises.writeFile(marker, 'shutdown complete\n'))
        }
    ]
});
shutdown.install();

// Stay alive until stopped; say when ready.
setInterval(() => {}, 1000);
console.log('ready');
