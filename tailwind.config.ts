import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import containerQueries from "@tailwindcss/container-queries";
import plugin from "tailwindcss/plugin";

const config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "var(--space-4)" },
    extend: {
      colors: {
        canvas: "var(--color-bg-canvas)",
        "surface-1": "var(--color-surface-1)",
        "surface-2": "var(--color-surface-2)",
        "surface-3": "var(--color-surface-3)",
        "surface-4": "var(--color-surface-4)",
        "surface-inset": "var(--color-surface-inset)",

        "border-subtle": "var(--color-border-subtle)",
        "border-default": "var(--color-border-default)",
        "border-strong": "var(--color-border-strong)",
        "border-focus": "var(--color-border-focus)",
        "border-ghost": "var(--color-border-ghost)",

        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary": "var(--color-text-tertiary)",
        "text-muted": "var(--color-text-muted)",
        "text-disabled": "var(--color-text-disabled)",
        "text-on-accent": "var(--color-text-on-accent)",
        "text-on-danger": "var(--color-text-on-danger)",

        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          active: "var(--color-accent-active)",
          soft: "var(--color-accent-soft)",
          ghost: "var(--color-accent-ghost)",
        },
        success: {
          DEFAULT: "var(--color-success)",
          soft: "var(--color-success-soft)",
        },
        warning: {
          DEFAULT: "var(--color-warning)",
          soft: "var(--color-warning-soft)",
        },
        danger: {
          DEFAULT: "var(--color-danger)",
          hover: "var(--color-danger-hover)",
          soft: "var(--color-danger-soft)",
        },
        info: "var(--color-info)",

        link: {
          1: "var(--color-link-1)",
          2: "var(--color-link-2)",
          3: "var(--color-link-3)",
          4: "var(--color-link-4)",
          5: "var(--color-link-5)",
          6: "var(--color-link-6)",
          7: "var(--color-link-7)",
          8: "var(--color-link-8)",
        },
      },

      fontFamily: {
        sans: [
          "Inter Variable",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono Variable",
          "JetBrains Mono",
          "ui-monospace",
          "Menlo",
          "monospace",
        ],
      },

      fontSize: {
        display: [
          "24px",
          { lineHeight: "32px", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        h1: [
          "20px",
          { lineHeight: "28px", letterSpacing: "-0.005em", fontWeight: "600" },
        ],
        h2: ["16px", { lineHeight: "24px", fontWeight: "600" }],
        h3: ["14px", { lineHeight: "20px", fontWeight: "600" }],
        body: ["13px", { lineHeight: "18px", fontWeight: "400" }],
        "body-strong": ["13px", { lineHeight: "18px", fontWeight: "500" }],
        small: ["12px", { lineHeight: "16px", fontWeight: "400" }],
        caption: [
          "11px",
          { lineHeight: "14px", letterSpacing: "0.02em", fontWeight: "500" },
        ],
        overline: [
          "10px",
          { lineHeight: "12px", letterSpacing: "0.06em", fontWeight: "600" },
        ],
        "mono-md": ["13px", { lineHeight: "18px", fontWeight: "500" }],
        "mono-sm": ["11px", { lineHeight: "14px", fontWeight: "500" }],
        "mono-xs": ["10px", { lineHeight: "12px", fontWeight: "500" }],
      },

      spacing: {
        "0.5": "2px",
        "1.5": "6px",
        "2.5": "10px",
        "row-compact": "28px",
        "row-comfortable": "36px",
        "row-cozy": "48px",
        "ctrl-xs": "20px",
        "ctrl-sm": "24px",
        "ctrl-md": "28px",
        "ctrl-lg": "32px",
        "ctrl-xl": "40px",
      },

      borderRadius: {
        none: "0",
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "var(--radius-full)",
      },

      boxShadow: {
        l0: "var(--shadow-l0)",
        l1: "var(--shadow-l1)",
        l2: "var(--shadow-l2)",
        l3: "var(--shadow-l3)",
        l4: "var(--shadow-l4)",
        focus: "var(--shadow-focus)",
        "focus-danger": "var(--shadow-focus-danger)",
      },

      opacity: {
        "dim-strong": "0.45",
        dim: "0.60",
        "dim-soft": "0.80",
        full: "1.00",
        disabled: "0.40",
        skeleton: "0.06",
        "skeleton-hi": "0.12",
      },

      transitionDuration: {
        instant: "0ms",
        fast: "80ms",
        DEFAULT: "160ms",
        slow: "240ms",
        slower: "320ms",
      },

      transitionTimingFunction: {
        out: "cubic-bezier(0.20, 0.80, 0.20, 1.00)",
        in: "cubic-bezier(0.40, 0.00, 0.80, 0.20)",
        "in-out": "cubic-bezier(0.40, 0.00, 0.20, 1.00)",
        spring: "cubic-bezier(0.34, 1.30, 0.64, 1.00)",
      },

      keyframes: {
        "skeleton-shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "panel-progress": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "toast-in": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "cmdk-in": {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "hud-pulse": {
          "0%, 100%": { opacity: "0.35", transform: "scale(0.85)" },
          "50%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "skeleton-shimmer": "skeleton-shimmer 1200ms linear infinite",
        "panel-progress": "panel-progress 1000ms linear infinite",
        "toast-in": "toast-in 320ms cubic-bezier(0.20, 0.80, 0.20, 1.00)",
        "cmdk-in": "cmdk-in 160ms cubic-bezier(0.20, 0.80, 0.20, 1.00)",
        "hud-pulse": "hud-pulse 1200ms cubic-bezier(0.40, 0.00, 0.20, 1.00) infinite",
      },
    },
  },
  plugins: [
    animate,
    containerQueries,
    plugin(({ addBase, addVariant }) => {
      addBase({
        "*, *::before, *::after": { boxSizing: "border-box" },
        "html, body, #root": {
          height: "100%",
          backgroundColor: "var(--color-bg-canvas)",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-sans)",
          fontFeatureSettings: '"cv11", "ss01"',
          textRendering: "optimizeLegibility",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          WebkitTapHighlightColor: "transparent",
        },
        "[data-scroll], .nx-scroll": {
          scrollbarGutter: "stable",
          scrollbarColor: "var(--color-border-strong) transparent",
          scrollbarWidth: "thin",
        },
        ".font-mono": {
          fontVariantNumeric: "tabular-nums",
          fontFeatureSettings: '"liga" 0',
        },
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.001ms !important",
            transitionDuration: "0.001ms !important",
          },
        },
      });

      addVariant("panel-focused", [
        '&[data-panel-focused="true"]',
        '[data-panel-focused="true"] &',
      ]);
      addVariant("panel-unfocused", [
        '&[data-panel-focused="false"]',
        '[data-panel-focused="false"] &',
      ]);
      addVariant("pinned", ['&[data-pinned="true"]', '[data-pinned="true"] &']);
      addVariant("density-compact", [
        '&[data-density="compact"]',
        '[data-density="compact"] &',
      ]);
      addVariant("density-comfortable", [
        '&[data-density="comfortable"]',
        '[data-density="comfortable"] &',
      ]);
      addVariant("density-cozy", [
        '&[data-density="cozy"]',
        '[data-density="cozy"] &',
      ]);
    }),
  ],
} satisfies Config;

export default config;
