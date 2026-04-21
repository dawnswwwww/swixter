/**
 * Bun Static File Server
 * Uses Bun.file() for web-native static file serving with SPA fallback.
 */

import { extname, join } from "node:path";
import { stat } from "node:fs/promises";

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
 * Serve a static file request using Bun.file().
 */
export async function serveStaticRequest(request: Request, options: StaticOptions): Promise<Response> {
  const { root, index = "index.html", spa = true } = options;
  const url = new URL(request.url);
  let filePath = join(root, url.pathname);

  try {
    const stats = await stat(filePath);

    if (stats.isDirectory()) {
      filePath = join(filePath, index);
    }

    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) throw new Error("not found");

    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new Response(file, {
      headers: { "Content-Type": contentType },
    });
  } catch {
    if (spa) {
      const indexPath = join(root, index);
      const file = Bun.file(indexPath);
      const exists = await file.exists();
      if (exists) {
        return new Response(file, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
}
