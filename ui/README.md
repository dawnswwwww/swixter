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

Output will be in `ui/dist/` directory.
