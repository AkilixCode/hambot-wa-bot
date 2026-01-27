/**
 * Browser Session Manager
 * Singleton pattern with connection pooling and health checks
 * Supports proxy configuration for Tailscale + Every Proxy
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const logger = require('./logger');
const config = require('../config');

puppeteer.use(StealthPlugin());

class BrowserManager {
    constructor() {
        this.browser = null;
        this.pages = new Set();
        this.maxPages = 5;
        this.isLaunching = false;
        this.healthCheckInterval = null;
    }

    /**
     * Get or create browser instance
     */
    async getBrowser() {
        // If browser exists and is connected, return it
        if (this.browser && this.browser.isConnected()) {
            return this.browser;
        }

        // Prevent multiple simultaneous launches
        if (this.isLaunching) {
            await this.waitForLaunch();
            return this.browser;
        }

        return await this.launch();
    }

    /**
     * Wait for browser to finish launching
     */
    async waitForLaunch() {
        let attempts = 0;
        while (this.isLaunching && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
    }

    /**
     * Launch new browser instance
     * Includes proxy configuration if enabled
     */
    async launch() {
        this.isLaunching = true;

        try {
            logger.info('Launching browser instance');
            
            // Build launch arguments
            const launchArgs = [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process'
            ];

            // Add proxy arguments if enabled
            const proxyArgs = config.getPuppeteerProxyArgs();
            if (proxyArgs.length > 0) {
                launchArgs.push(...proxyArgs);
                logger.info(`Browser using proxy: ${config.getProxyUrl()}`);
            }
            
            this.browser = await puppeteer.launch({
                headless: "new",
                args: launchArgs
            });

            // Start health check
            this.startHealthCheck();

            logger.info('Browser launched successfully');
            return this.browser;

        } catch (error) {
            logger.error(error, { context: 'browser-launch' });
            throw error;
        } finally {
            this.isLaunching = false;
        }
    }

    /**
     * Create new page with tracking
     * Handles proxy authentication if needed
     */
    async newPage() {
        if (this.pages.size >= this.maxPages) {
            throw new Error('Maximum page limit reached');
        }

        const browser = await this.getBrowser();
        const page = await browser.newPage();
        
        // Handle proxy authentication if credentials are provided
        if (config.proxy.enabled && config.proxy.user && config.proxy.pass) {
            await page.authenticate({
                username: config.proxy.user,
                password: config.proxy.pass
            });
        }
        
        this.pages.add(page);
        
        // Auto-remove from tracking when closed
        page.once('close', () => {
            this.pages.delete(page);
        });

        return page;
    }

    /**
     * Close a specific page
     */
    async closePage(page) {
        if (page && !page.isClosed()) {
            await page.close();
            this.pages.delete(page);
        }
    }

    /**
     * Close all open pages
     */
    async closeAllPages() {
        const closePromises = Array.from(this.pages).map(page => 
            this.closePage(page).catch(() => {})
        );
        await Promise.all(closePromises);
        this.pages.clear();
    }

    /**
     * Start health check interval
     */
    startHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            try {
                if (!this.browser || !this.browser.isConnected()) {
                    logger.warn('Browser disconnected, will relaunch on next request');
                    this.browser = null;
                    return;
                }

                // Close idle pages if too many
                if (this.pages.size > this.maxPages) {
                    const pagesToClose = Array.from(this.pages).slice(0, this.pages.size - this.maxPages);
                    for (const page of pagesToClose) {
                        await this.closePage(page);
                    }
                }
            } catch (error) {
                logger.error(error, { context: 'browser-health-check' });
            }
        }, 30000); // Check every 30 seconds
    }

    /**
     * Get browser statistics
     */
    getStats() {
        return {
            isConnected: this.browser?.isConnected() || false,
            openPages: this.pages.size,
            maxPages: this.maxPages
        };
    }

    /**
     * Gracefully shutdown browser
     */
    async destroy() {
        logger.info('Shutting down browser manager');
        
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        await this.closeAllPages();

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

module.exports = new BrowserManager();
