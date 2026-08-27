/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/**/*.{ts,tsx,html}"],
  darkMode: ["class", ".theme-dark"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--background)",
        card: "var(--surface-container-lowest)",
        surface: "var(--surface)",
        "surface-low": "var(--surface-container-low)",
        "surface-mid": "var(--surface-container)",
        "surface-high": "var(--surface-container-high)",
        ink: "var(--on-surface)",
        muted: "var(--on-surface-variant)",
        faint: "var(--font-disabled)",
        line: "var(--outline-variant)",
        strongline: "var(--outline)",
        primary: {
          DEFAULT: "var(--primary)",
          hover: "var(--primary-hover)",
          soft: "var(--tertiary-container)",
          onsoft: "var(--on-tertiary-container)",
        },
        "on-primary": "var(--on-primary)",
        ok: { DEFAULT: "var(--success)", soft: "var(--success-container)" },
        warn: { DEFAULT: "var(--warning)", soft: "var(--warning-container)" },
        err: { DEFAULT: "var(--error)", soft: "var(--error-container)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-container)" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl2: "14px",
      },
    },
  },
  plugins: [],
};
