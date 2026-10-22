/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#05070d",
        surface: "#0e1420",
        surface2: "#151d2e",
        line: "#232c40",
        ink: "#e5e9f0",
        muted: "#8b96ab",
        accent: "#38bdf8",
        accent2: "#2dd4bf",
        slot: {
          free: "#22c55e",
          booked: "#facc15",
          occupied: "#ef4444",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 24px -4px rgba(56, 189, 248, 0.35)",
        "glow-green": "0 0 16px -2px rgba(34, 197, 94, 0.55)",
        "glow-red": "0 0 16px -2px rgba(239, 68, 68, 0.55)",
        "glow-amber": "0 0 16px -2px rgba(245, 158, 11, 0.55)",
        "glow-yellow": "0 0 14px -2px rgba(250, 204, 21, 0.55)",
      },
      keyframes: {
        "pulse-slow": {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.5 },
        },
        "fade-in": {
          from: { opacity: 0, transform: "translateY(4px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-slow": "pulse-slow 2.5s ease-in-out infinite",
        "fade-in": "fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
