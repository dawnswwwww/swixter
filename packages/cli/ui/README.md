# Swixter Web UI

## Prerequisites

This project requires additional dependencies that need to be installed manually:

### Step 1: Install dependencies

```bash
cd ui
npm install
```

### Step 2: Install shadcn/ui (optional - for enhanced UI components)

```bash
npx shadcn@latest init
```

When prompted, select:
- Style: Default
- Base color: Slate
- CSS variables: Yes

Then add required components:

```bash
npx shadcn@latest add button card dialog dropdown-menu input label select separator table tabs toast badge form switch scroll-area
```

### Step 3: Run development server

```bash
npm run dev
```

The UI will be available at http://localhost:5173 with API proxy to :3141.

## Build for production

```bash
npm run build
```

Output will be in `../crates/server/ui_dist/` (inside the server crate).

## Committed prebuilt assets

`crates/server/ui_dist/` is committed to git as the UI asset source for
release builds (cargo-dist jobs run `cargo build` directly, with no chance
to build the UI first). It lives inside the server crate so that
`cargo package` / `cargo publish` include it — an out-of-crate embed folder
would silently ship the placeholder page to `cargo install` users. After
changing anything under `ui/src/`, you MUST run
`bun install && bun run build` and commit the updated `ui_dist/` together
with your source changes.
