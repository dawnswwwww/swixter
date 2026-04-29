/**
 * Static File Server
 * Serves static files using node:fs for Node.js compatibility.
 */

import { extname, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export interface StaticOptions {
  root: string;
  index?: string;
  spa?: boolean;
}

/**
 * Serve a static file request, writing directly to the ServerResponse.
 */
export async function serveStaticFile(
  _req: IncomingMessage,
  res: ServerResponse,
  options: StaticOptions,
): Promise<void> {
  const { root, index = "index.html", spa = true } = options;
  const url = new URL(_req.url || "/", `http://${_req.headers.host || "localhost"}`);
  let filePath = join(root, url.pathname);

  try {
    const stats = await stat(filePath);

    if (stats.isDirectory()) {
      filePath = join(filePath, index);
    }

    const content = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.statusCode = 200;
    res.end(content);
  } catch {
    if (spa) {
      const indexPath = join(root, index);
      try {
        const content = await readFile(indexPath);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.statusCode = 200;
        res.end(content);
      } catch {
        res.statusCode = 404;
        res.end("Not Found");
      }
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
  }
}
