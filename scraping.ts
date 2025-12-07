import {APIResponse, Browser, chromium, Page} from "playwright";
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
import {BrowserContextOptions, Response} from "playwright-core";
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
export const DEFAULT_HEADLESS = false;

// Internal constants:
const HTML_FILENAME_REGEX = /.+\.(html|htm|xhtml|xml)/gi;
const HTML_CONTENT_TYPE_REGEX = /.+\/(html|htm|xhtml|xml)/gi;
const IGNORE_URL_REGEX = /.+\/about:blank$/gi;

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
    const browser = await chromium.launch({...bcOptions, headless: DEFAULT_HEADLESS});
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

function removeExtensionOrFragment(url: string): string {
    return /.+\/$/.test(url)
        ? url
        : (/.+\/(.+\.[a-zA-Z0-9]{2,5}|#[^\/]*)$/.test(url)
            ? url.replace(/\/[^\/]*\/?$/, '/')
            : url);
}

function filterSameDomainLinks(currentUrl: string,
                               links: string[],
                               params: CrawlParams): string[] {
    return links
        .map((link) => link.trim())
        .map((link) => {
            // If link already contains a protocol, use it as-is
            if (/^https?:\/\//i.test(link)) return link;
            return encodeUrl(
                removeDoubleBars(
                    unionUrl(
                        removeExtensionOrFragment(currentUrl),
                        link)));
        })
        .filter((link) => !IGNORE_URL_REGEX.test(link))
        .filter((link) => {
            try {
                let url = new URL(link);
                return url.hostname.includes(params.domain.base) || url.hostname === null;
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

interface HttpResponse {
    response: {
        status?: number | null | undefined,
        headers?: Record<string, string> | null | undefined,
        body?: Buffer | null | undefined,
        text?: string | null | undefined,
        binary?: boolean,
        url: string
    }
}

async function fetch(page: Page,
                     url: string,
                     params: CrawlParams): Promise<APIResponse> {
    logger.info(`Fetch method called for url ${url}`);
    return await page.request.fetch(url, {
        timeout: params.timeout || DEFAULT_TIMEOUT_MILLIS,
        maxRetries: params.maxRetries || DEFAULT_MAX_RETRIES
    });
}

async function goto(page: Page,
                    url: string,
                    params: CrawlParams): Promise<null | Response> {
    logger.info(`Goto method called for url ${url}`);
    return await page.goto(url, {
        timeout: params.timeout || DEFAULT_TIMEOUT_MILLIS,
        waitUntil: "commit"
    });
}

async function request(page: Page,
                       url: string,
                       params: CrawlParams): Promise<HttpResponse> {
    let result: HttpResponse = {
        response: {
            status: 0,
            url: url,
            binary: false
        }
    }
    let response: any;
    response = await goto(page, url, params);
    const contentType = response.headers()['content-type'];
    logger.info(`Response status ${response.status()} and headers: ${JSON.stringify(response.headers())} for ${url}`);

    if (!HTML_FILENAME_REGEX.test(url) && !HTML_CONTENT_TYPE_REGEX.test(contentType)) {
        response = await fetch(page, url, params);
        result.response.binary = true;
    }
    if (response) {
        result.response.status = response.status();
        result.response.headers = response.headers();
        result.response.body = await response.body();
        result.response.text = await response.text();
    }

    logger.info(`Response status: ${result.response.status}, payload size: ${result.response.body?.length}, headers: ${JSON.stringify(response.headers())} for ${url}`);
    return result;
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

async function handleCookieConsent(page: Page): Promise<void> {
    const selectors = [
        'button:has-text("Accept")',
        'button:has-text("Accept all")',
        'button#accept-choices',
        'button.cookie-accept',
        'a:has-text("Accept Cookies")'
    ];

    for (const selector of selectors) {
        try {
            await page.waitForSelector(selector, {state: 'visible', timeout: 2000});
            await page.click(selector);
            logger.info(`Accepted cookies using selector: ${selector}`);
            await page.waitForTimeout(1000);
            break;
        } catch (error) {
            logger.error(`Handle cookie consent error: ${error}`)
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
                    // Cookie consent:
                    // await handleCookieConsent(page);

                    // Save page content:
                    const url = decodeURIComponent(removePortFromUrl(page.url() || EMPTY));
                    await savePageContent(result.response.body, params.baseOutputDir, url, params.overrides || false);

                    // Extract new links:
                    if (result.response.binary) continue;
                    const extractedLinks = extractLinks(result.response.text || EMPTY);
                    logger.info(`Extracted links: ${extractedLinks}`);

                    // Filter new links:
                    const filteredLinks = filterSameDomainLinks(page.url(), extractedLinks, params);
                    logger.info(`Filtered links: ${filteredLinks}`);

                    // Add new links to queue:
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
