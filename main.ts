import {
    crawl,
    CrawlParams,
    DEFAULT_DOMAIN_BASE, DEFAULT_INTERVAL_BETWEEN_REQUESTS, DEFAULT_INTERVAL_FACTOR, DEFAULT_OUTPUT_DIR,
    DEFAULT_OVERRIDES, DEFAULT_PORT,
    DEFAULT_PROTOCOL,
    DEFAULT_PROXY_SERVER, DEFAULT_START_PATH,
    DEFAULT_TIMEOUT_MILLIS
} from "./scraping.js";
import logger from "./logger.js";
import dotenv from 'dotenv';

dotenv.config();

async function executeCrawl(config: CrawlParams): Promise<void> {
    try {
        logger.info(`---------- Starting crawl for ${config.domain.base} ----------`);
        await crawl(config);
        logger.info(`---------- Crawl completed successfully for ${config.domain.base} ----------`);
    } catch (error) {
        logger.error(`***** Crawl failed for ${config.domain}: ${(error as Error).message} *****`);
        throw error;
    }
}

/**
 * Main entry point
 */
const CRAWL_CONFIG: CrawlParams = {
    protocol: process.env.PROTOCOL || DEFAULT_PROTOCOL,
    domain: {
        base: process.env.DOMAIN_BASE || DEFAULT_DOMAIN_BASE,
        start: process.env.DOMAIN_START || process.env.DOMAIN_BASE || DEFAULT_DOMAIN_BASE,
        startPath: process.env.START_PATH || DEFAULT_START_PATH,
    },
    port: process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT,
    baseOutputDir: process.env.BASE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    overrides: process.env.OVERRIDES === 'true' || DEFAULT_OVERRIDES,
    intervalBetweenRequests: process.env.INTERVAL_BETWEEN_REQUESTS
        ? parseInt(process.env.INTERVAL_BETWEEN_REQUESTS)
        : DEFAULT_INTERVAL_BETWEEN_REQUESTS,
    intervalFactor: process.env.INTERVAL_FACTOR
        ? parseInt(process.env.INTERVAL_FACTOR)
        : DEFAULT_INTERVAL_FACTOR,
    timeout: process.env.TIMEOUT
        ? parseInt(process.env.TIMEOUT)
        : DEFAULT_TIMEOUT_MILLIS,
    proxy: process.env.PROXY || DEFAULT_PROXY_SERVER,
};

await executeCrawl(CRAWL_CONFIG);
