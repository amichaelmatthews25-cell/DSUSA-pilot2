/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0F1B2D", soft: "#33405A", muted: "#6B7689" },
        canvas: { DEFAULT: "#F7F8FA", panel: "#FFFFFF", line: "#E5E8EE" },
        brand: { DEFAULT: "#1D4E89", deep: "#143A66", tint: "#EAF1F9" },
        signal: { DEFAULT: "#1B9C7A", tint: "#E6F4EF" },
        warn: { DEFAULT: "#C9821B", tint: "#FBF1E2" },
        track: { done: "#1B9C7A", now: "#1D4E89", next: "#C3CAD6" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Fraunces", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,27,45,0.04), 0 4px 16px rgba(15,27,45,0.06)",
      },
      borderRadius: { xl2: "1rem" },
    },
  },
  plugins: [],
};
