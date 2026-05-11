---
name: Citron Terminal
colors:
  surface: '#151309'
  surface-dim: '#151309'
  surface-bright: '#3c392d'
  surface-container-lowest: '#100e05'
  surface-container-low: '#1e1c11'
  surface-container: '#222014'
  surface-container-high: '#2c2a1e'
  surface-container-highest: '#373528'
  on-surface: '#e8e2d0'
  on-surface-variant: '#cdc7ac'
  inverse-surface: '#e8e2d0'
  inverse-on-surface: '#333124'
  outline: '#969179'
  outline-variant: '#4a4733'
  surface-tint: '#dbc90b'
  primary: '#f5e232'
  on-primary: '#363100'
  primary-container: '#d8c603'
  on-primary-container: '#5a5200'
  inverse-primary: '#695f00'
  secondary: '#d3c87e'
  on-secondary: '#373100'
  secondary-container: '#514a0c'
  on-secondary-container: '#c5ba71'
  tertiary: '#70f2ff'
  on-tertiary: '#00363b'
  tertiary-container: '#35d7e5'
  on-tertiary-container: '#005a61'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#f8e535'
  primary-fixed-dim: '#dbc90b'
  on-primary-fixed: '#1f1c00'
  on-primary-fixed-variant: '#4f4800'
  secondary-fixed: '#f0e497'
  secondary-fixed-dim: '#d3c87e'
  on-secondary-fixed: '#201c00'
  on-secondary-fixed-variant: '#4f4709'
  tertiary-fixed: '#82f3ff'
  tertiary-fixed-dim: '#3adae7'
  on-tertiary-fixed: '#002022'
  on-tertiary-fixed-variant: '#004f55'
  background: '#151309'
  on-background: '#e8e2d0'
  surface-variant: '#373528'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  body-base:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.6'
  code-sm:
    fontFamily: monospace
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  gutter: 20px
  container-max: 1440px
---

## Brand & Style

The brand personality for this design system is centered on high-visibility precision, synthetic clarity, and technical authority. It targets a developer audience that values high-density information and a high-energy, modern workspace. The emotional response is "electric focus"—a sharp, high-contrast environment that feels like a high-end diagnostic interface or a next-gen debugging terminal.

The visual style follows a **High-Tech Minimalism** approach with an obsidian-depth edge. It utilizes a deep, charcoal-toned dark background to minimize eye strain and maintain legibility, punctuated by electric citron and neon cyan accents. Layouts are strictly card-based to create modularity, using subtle borders and a balanced geometric approach to evoke a sophisticated, instrumentation-inspired aesthetic.

## Colors

This design system utilizes a "Citron & Cyan" palette optimized for dark mode. The foundation is built on deep, professional neutrals with a slight olive-drab undertone. The primary accent is an **Electric Citron** (`#d8c603`), reserved for high-priority calls-to-action, status indicators, and key structural highlights.

Secondary information and borders use muted olive-taupe tones to maintain a clear hierarchy without visual clutter. 
- **Primary:** Electric Citron for high-priority interaction and attention.
- **Secondary:** Muted Olive for secondary actions and technical depth.
- **Tertiary:** Neon Cyan (`#5bf1ff`) for data visualizations, tooltips, and informational highlights.
- **Neutral:** Deep Greys for text and structural dividers, providing a stable contrast against the bright accents.

## Typography

The typography strategy prioritizes legibility in high-density data environments. **Inter** serves as the primary workhorse for the UI, offering exceptional clarity at small sizes. For technical labels and data-heavy headers, **Space Grotesk** is used to inject a subtle futuristic, geometric character reminiscent of engineering schematics.

For all code blocks, CLI examples, and configuration files, use a crisp monospace stack. Maintain a generous line-height for code to ensure complex syntax remains scannable. Use `label-caps` for table headers and metadata categories to create a distinct visual break from body content against the dark canvas.

## Layout & Spacing

This design system employs a **Fixed-Fluid Hybrid Grid**. Content is housed within a 12-column grid with a maximum container width of 1440px. The spacing rhythm is strictly based on a 4px baseline, ensuring all elements align to a predictable technical scale.

Layouts are organized into "Functional Zones":
1. **Sidebar/Navigation:** Fixed width (240px) for consistent tool access.
2. **Main Canvas:** Fluid area for code editors or dashboards.
3. **Utility Panels:** Right-aligned drawers for documentation or properties.

Gutters are kept tight (20px) to maximize screen real estate, reflecting the high-information density required by developer tools.

## Elevation & Depth

In this dark-themed environment, depth is communicated through **Tonal Layering** and **Luminous Outlines**. Surfaces are distinguished by subtle shifts in brightness rather than heavy shadows to maintain the technical, flat aesthetic.

The background sits at the lowest level (Level 0) in a deep charcoal. Cards and interactive surfaces sit at Level 1, using slightly lighter surface tones. Floating elements like tooltips or dropdowns sit at Level 2, distinguished by a subtle 1px border (`#7b7768`) and a very slight, sharp glow to provide separation from the dark canvas. 

Backdrop blurs (12px to 20px) are used on overlays to maintain context of the underlying code while focusing the user's attention.

## Shapes

The shape language is "Functional Precision." While maintaining a high-tech, engineered look, we utilize a more approachable curvature to soften the technical density. The standard `roundedness` is set to **Rounded** (0.5rem / 8px) for cards, buttons, and input fields. This creates a modern, software-focused feel that balances the sharp typography and vibrant accents.

Nested elements (like buttons inside cards) should use a slightly reduced radius (4px or 0.25rem) to maintain visual nested harmony. Iconography should follow a 2px stroke weight with consistent rounding to match the UI component corners.

## Components

### Buttons
- **Primary:** Solid `#d8c603` background with high-contrast dark text. No border. Uses the standard 8px corner radius.
- **Secondary:** Transparent background with a 1px Muted Olive border (`#817837`).
- **Ghost:** No background or border. Text in light grey. Citron underline on hover.

### Cards
Cards are the primary container unit. They feature a dark grey surface, a subtle 1px border, and an 8px radius. For active or "focused" states, the border transitions to a dimmed version of the primary Citron.

### Input Fields
Inputs use a monochromatic approach. A deep charcoal background with a 1px inner border and 8px radius. The focus state is indicated by a 1px primary citron border and a matching subtle outer glow.

### Chips & Tags
Used for status and categories. They should be small, using the `label-caps` typography style. Info tags use a subtle cyan tint background (15% opacity) with solid cyan text (`#5bf1ff`), while priority tags use a bright citron tint.

### Terminal/Code Blocks
Wrapped in a distinct, darker container (Level 0) to differentiate from standard UI cards. These blocks should still respect the 8px corner radius to maintain system-wide consistency. Headers for code blocks should include a "Copy" button and the language identifier in the top-right corner.
