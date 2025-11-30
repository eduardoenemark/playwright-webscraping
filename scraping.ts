import {Browser, chromium, Page} from "playwright";
import * as fs from "fs/promises";
import {
    createDirectories,
    EMPTY,
    existsFile,
    getFileFullPath,
    interval,
    removeDoubleBars,
    removePortFromUrl,
    saveFile,
    unionUrl,
    unionUrlParts
} from "./utils.js";
import logger from "./logger.js";
import {BrowserContextOptions} from "playwright-core";
import encodeUrl from "encodeurl";

// Constantes:
export const DEFAULT_PROXY_SERVER = "http://hefesto:55455";
export const DEFAULT_TIMEOUT_MILLIS = 60 * 1000;
export const DEFAULT_HTTP_SUCCESS_STATUS_CODES = 200;
export const DEFAULT_MAX_RETRIES = 20;
export const DEFAULT_INTERVAL_FACTOR = 0.5;
export const DEFAULT_INTERVAL_BETWEEN_REQUESTS = 5000;
export const DEFAULT_PROTOCOL = "https";
export const DEFAULT_DOMAIN_BASE = "localhost";
export const DEFAULT_PORT = 8080;
export const DEFAULT_START_PATH = "/";
export const DEFAULT_OUTPUT_DIR = "./site_archive";
export const DEFAULT_OVERRIDES = false;

// Interface
export interface CrawlParams {
    protocol: string;
    domain: {
        base: string;
        start: string;
        startPath: string;
    };
    port: number;
    baseOutputDir: string;
    overrides?: boolean;
    intervalBetweenRequests?: number;
    intervalFactor?: number;
    timeout?: number;
    maxRetries?: number;
    proxy: string;
}

async function initializeBrowser(bcOptions: BrowserContextOptions): Promise<{
    browser: Browser;
    page: Page
}> {
    const browser = await chromium.launch(bcOptions);
    // create a new context to allow setting viewport and other options
    const context = await browser.newContext(bcOptions);
    const page = await context.newPage();
    return {browser, page};
}

function extractLinks(html: string): string[] {
    const attributeRegex = /(href|src)\s*=\s*["']([^"']+)["']/gi;
    const matches = [...html.matchAll(attributeRegex)];
    return matches.map(match => match[2]);
}

function filterSameDomainLinks(currentUrl: string,
                               links: string[],
                               params: CrawlParams): string[] {
    return links
        .map((link) => link.trim())
        .map((link) => {
            // If link already contains a protocol, use it as-is
            if (/^https?:\/\//i.test(link)) return link;
            return encodeUrl(removeDoubleBars(unionUrl(currentUrl, link)));
        })
        .filter((url) => {
            logger.info(`Filtering link ${url}`);
            try {
                return new URL(url).hostname.includes(params.domain.base);
            } catch {
                return false;
            }
        });
}

async function savePageContent(content: string | Buffer | null | undefined,
                               baseOutputDir: string,
                               url: string,
                               overrides: boolean): Promise<void> {
    await createDirectories(baseOutputDir, url);
    const fileFullPath = getFileFullPath(baseOutputDir, url);
    logger.info(`File full path ${fileFullPath}`);

    if (!overrides && await existsFile(baseOutputDir, url)) {
        logger.info(`File already exists for URL ${url}`);
        return;
    }

    let payload: Uint8Array;
    if (typeof content === 'string') {
        payload = new Uint8Array(Buffer.from(content, 'utf-8'));
    } else if (content instanceof Buffer) {
        payload = new Uint8Array(content);
    } else {
        payload = new Uint8Array();
    }

    logger.info(`Payload size ${payload.length} bytes for URL ${url}`);
    if (content !== null) await saveFile(baseOutputDir, url, payload);
}

async function request(page: Page,
                       url: string,
                       params: CrawlParams): Promise<{
    response: {
        status: number | null,
        headers: Record<string, string> | null,
        body: Buffer | null,
        text: string | null,
        url: string
    }
}> {
    logger.info('Fetch method called...');
    const response = await page.request.fetch(url, {
        timeout: params.timeout || DEFAULT_TIMEOUT_MILLIS,
        maxRetries: params.maxRetries || DEFAULT_MAX_RETRIES
    });
    logger.info(`Response status ${response?.status()} and headers: ${JSON.stringify(response?.headers())} for ${url}`);

    return {
        response: {
            status: response?.status(),
            headers: response?.headers(),
            body: await response?.body(),
            text: await response?.text(),
            url: url
        }
    };
}

function enqueueNewLinks(links: string[],
                         visited: Set<string>,
                         queue: string[]): void {
    for (const link of links) {
        if (!visited.has(link)) {
            queue.push(link);
        }
    }
}

export async function crawl(params: CrawlParams): Promise<void> {

    let bcOptions: BrowserContextOptions = {
        viewport: {width: 1280, height: 800},
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
        colorScheme: 'dark',
        baseURL: `${params.protocol}://${params.domain.start}:${params.port}`,
        proxy: {server: params.proxy},
        recordHar: {
            omitContent: false,
            content: "attach",
            path: getFileFullPath(params.baseOutputDir, params.domain.base),
            mode: "full"
            /*urlFilter?: string|RegExp;*/
        }
    }
    const {browser, page} = await initializeBrowser(bcOptions);
    await fs.mkdir(params.baseOutputDir, {recursive: true});

    const visited = new Set<string>();
    const queue: string[] = [unionUrlParts(
        params.protocol,
        params.domain.start,
        params.port,
        params.domain.startPath)];
    try {
        while (queue.length > 0) {
            const currentUrl = queue.shift()!;
            logger.info(`Processing URL ${currentUrl}`);
            if (visited.has(currentUrl)) {
                continue;
            }
            visited.add(currentUrl);
            try {
                const result = await request(page, currentUrl, params);
                if (result?.response.status === DEFAULT_HTTP_SUCCESS_STATUS_CODES) {
                    const url = decodeURIComponent(removePortFromUrl(result?.response?.url || EMPTY));
                    await savePageContent(result?.response?.body, params.baseOutputDir, url, params.overrides || false);

                    const extractedLinks = extractLinks(result?.response?.text || EMPTY);
                    logger.info(`Extracted links: ${extractedLinks}`);

                    const filteredLinks = filterSameDomainLinks(result?.response?.url, extractedLinks, params);
                    logger.info(`Filtered links: ${filteredLinks}`);

                    enqueueNewLinks(filteredLinks, visited, queue);
                }
            } catch (error) {
                logger.error(
                    `Failed to process ${currentUrl}: ${(error as Error).message}`
                );
            }
            await interval(params.intervalBetweenRequests, params.intervalFactor);
        }
    } finally {
        await browser.close();
    }
}
