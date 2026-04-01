/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--bg-base)",
        foreground: "var(--text-primary)",
        surface: {
          DEFAULT: "var(--bg-surface)",
          elevated: "var(--bg-elevated)",
        },
        border: "var(--border-subtle)",
        borderStrong: "var(--border-strong)",
        primary: {
          DEFAULT: "var(--accent-amber)",
          muted: "var(--accent-amber-muted)",
        },
        success: "var(--status-success)",
        warning: "var(--status-warning)",
        destructive: "var(--status-error)",
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "SF Mono", "Fira Code", "monospace"],
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      borderRadius: {
        NONE: "0",
        SM: "2px",
        MD: "4px",
        DEFAULT: "4px",
      },
      spacing: {
        "18": "4.5rem",
        "88": "22rem",
      },
    },
  },
  plugins: [],
}
