import * as fs from "fs";
import path from "path";
import logger from "./logger.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Empty string constant used throughout the module
 */
export const EMPTY = "";

/**
 * Regular expression to detect if a URL already contains a file extension
 */
const URL_EXTENSION_REGEX = /.+:\/\/.+\/.+\.[a-zA-Z0-9]+$/;

/**
 * Regular expression to remove protocol from URL
 */
const PROTOCOL_REGEX = /^.+:\/\//;

export type UrlParts = {
    directoryPath: string;
    filename: string;
};

export function splitUrl(url: string): UrlParts {
    const urlWithoutProtocol = url.replace(PROTOCOL_REGEX, "");
    const parts = urlWithoutProtocol.split("/");

    const filename = parts[parts.length - 1] || "index";
    const directoryPath = parts.slice(0, -1).join("/");

    return {
        directoryPath,
        filename
    };
}

export function unionUrlParts(protocol: string, domain: string, port: number, path?: string): string {
    const partial = domain.concat(`:${port}`).concat(path ? `/${path}` : EMPTY);
    return `${protocol}://${partial.replaceAll(/\/\//g, "/")}`;
}

export function unionUrl(baseUrl: string, path?: string): string {
    const separator = baseUrl.endsWith("/") || (path && path.startsWith("/")) ? "" : "/";
    return `${baseUrl}${separator}${path ? path : EMPTY}`;
}

export function existsExtensionInUrl(url: string): boolean {
    return URL_EXTENSION_REGEX.test(url);
}

export async function createDirectories(baseOutputDir: string, url: string): Promise<void> {
    try {
        const {directoryPath} = splitUrl(url);
        const fullPath = path.join(baseOutputDir, directoryPath);
        fs.mkdirSync(fullPath, {recursive: true});
        logger.info(`Created directories ${directoryPath}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to create directories for URL ${url}: ${errorMessage}`);
        throw error;
    }
}

export function removePortFromUrl(url: string): string {
    return url.replace(/:[0-9]+/, EMPTY);
}

export function getFileFullPath(baseOutputDir: string, url: string): string {
    const {directoryPath, filename} = splitUrl(url);
    return path.join(baseOutputDir, directoryPath, filename);
}

export async function saveFile(baseOutputDir: string,
                               url: string,
                               body: null | Uint8Array): Promise<void> {
    try {
        if (body !== null) {
            const filePath = getFileFullPath(baseOutputDir, url);
            fs.writeFileSync(filePath, body);
            logger.info(`Saved file: ${filePath}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to save file for URL ${url}: ${errorMessage}`);
        throw error;
    }
}

export async function existsFile(baseOutputDir: string,
                                 url: string): Promise<boolean> {
    return fs.existsSync(getFileFullPath(baseOutputDir, url));
}

export function removeDoubleBars(url: string): string {
    const regex = /(\/{2,})/g;
    let parts = url.split('://');
    if (parts.length > 1) {
        return parts[0] + '://' + parts[1].replace(regex, '/');
    }
    return url.replace(regex, '/');
}

export async function interval(millis: number = 0, factor: number = 1): Promise<void> {
    const delay = millis + (Math.random() * factor);
    await new Promise((resolve) => setTimeout(resolve, delay));
}
