// Serves the swixter installers through swixter.cc instead of GitHub Releases.
//
//   /install.sh    -> swixter-installer.sh (latest), download URLs rewritten to this Worker
//   /install.ps1   -> swixter-installer.ps1 (latest), same rewriting
//   /releases/*    -> passthrough proxy for github.com/dawnswwwww/swixter/releases/download/*
//
// The cargo-dist installers embed a versioned base URL
// (ARTIFACT_DOWNLOAD_URLS="https://github.com/dawnswwwww/swixter/releases/download/vX.Y.Z"),
// so rewriting the releases prefix routes the actual binary downloads through the edge too.

const RELEASES_BASE = 'https://github.com/dawnswwwww/swixter/releases/download';
const LATEST_BASE = 'https://github.com/dawnswwwww/swixter/releases/latest/download';
// Canonical public origin used when rewriting download URLs inside installers.
const PUBLIC_ORIGIN = 'https://swixter.cc';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);

    if (url.pathname === '/install.sh') {
      return serveInstaller(`${LATEST_BASE}/swixter-installer.sh`);
    }
    if (url.pathname === '/install.ps1') {
      return serveInstaller(`${LATEST_BASE}/swixter-installer.ps1`);
    }
    if (url.pathname.startsWith('/releases/')) {
      const asset = url.pathname.slice('/releases/'.length);
      if (!asset || asset.split('/').includes('..')) {
        return new Response('Not found', { status: 404 });
      }
      return proxyAsset(request, ctx, `${RELEASES_BASE}/${asset}`);
    }
    return new Response('Not found', { status: 404 });
  },
};

async function serveInstaller(upstream) {
  const res = await fetch(upstream, {
    cf: { cacheEverything: true, cacheTtl: 300 },
  });
  if (!res.ok) {
    return new Response(`Upstream error: ${res.status}`, { status: 502 });
  }
  const script = await res.text();
  const rewritten = script.replaceAll(RELEASES_BASE, `${PUBLIC_ORIGIN}/releases`);
  return new Response(rewritten, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}

async function proxyAsset(request, ctx, upstream) {
  const cached = await caches.default.match(request);
  if (cached) return cached;

  const res = await fetch(upstream, {
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!res.ok) {
    return new Response(`Upstream error: ${res.status}`, { status: 502 });
  }
  const proxied = new Response(res.body, {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'public, max-age=3600',
    },
  });
  ctx.waitUntil(caches.default.put(request, proxied.clone()));
  return proxied;
}
