/**
 * Static File Server
 * Serves static files from a directory
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * MIME types for common file extensions
 */
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
  ".eot": "application/vnd.ms-fontobject",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

/**
 * Static file server options
 */
export interface StaticServeOptions {
  /** Root directory for static files */
  root: string;
  /** Default file to serve for directory requests (default: index.html) */
  index?: string;
  /** Enable SPA mode - serve index.html for unmatched routes (default: true) */
  spa?: boolean;
}

/**
 * Create a static file server handler
 */
export function createStaticServe(options: StaticServeOptions): (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void> {
  const { root, index = "index.html", spa = true } = options;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    let filePath = join(root, url.pathname);

    try {
      // Get file stats
      const stats = await stat(filePath);

      // If it's a directory, try to serve index file
      if (stats.isDirectory()) {
        filePath = join(filePath, index);
        await stat(filePath); // Check if index exists
      }

      // Determine content type
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      // Stream file to response
      res.setHeader("Content-Type", contentType);
      const stream = createReadStream(filePath);

      stream.on("error", (error) => {
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.end("Internal Server Error");
        }
      });

      stream.pipe(res);
    } catch (error) {
      // File not found
      if (spa) {
        // SPA mode: serve index.html for all unmatched routes
        try {
          const indexPath = join(root, index);
          const stats = await stat(indexPath);

          if (stats.isFile()) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            const stream = createReadStream(indexPath);
            stream.pipe(res);
            return;
          }
        } catch {
          // Index file not found
        }
      }

      // 404
      if (!res.writableEnded) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not Found");
      }
    }
  };
}
