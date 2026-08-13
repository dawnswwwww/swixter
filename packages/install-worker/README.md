# swixter-install Worker

Proxies the swixter installers through `swixter.cc` so users don't hit GitHub Releases directly.

| Route | Upstream |
|-------|----------|
| `swixter.cc/install.sh` | `github.com/.../releases/latest/download/swixter-installer.sh` (download URLs rewritten to this Worker) |
| `swixter.cc/install.ps1` | `github.com/.../releases/latest/download/swixter-installer.ps1` (same rewriting) |
| `swixter.cc/releases/*` | `github.com/dawnswwwww/swixter/releases/download/*` (streamed, edge-cached 1h) |

End-user commands once deployed:

```bash
curl -LsSf https://swixter.cc/install.sh | sh
powershell -ExecutionPolicy Bypass -c "irm https://swixter.cc/install.ps1 | iex"
```

## Deploy

Requires a Cloudflare login on the account that owns the `swixter.cc` zone (wrangler will prompt on first run):

```bash
cd packages/install-worker
bunx wrangler deploy
```

Or non-interactively with `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit on the account) set.

Verify:

```bash
curl -LsSf https://swixter.cc/install.sh | head -40   # ARTIFACT_DOWNLOAD_URLS should point at swixter.cc
```

After the Worker is live, update the install commands in `packages/website`, the README, and the docs to the new URLs.
