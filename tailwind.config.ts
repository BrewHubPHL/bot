import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // These match the CSS variables we defined in your RootLayout
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui"],
        playfair: ["var(--font-playfair)", "serif"],
      },
      colors: {
        // Adding some custom 'BrewHub' tones for that premium feel
        stone: {
          50: "#fdfcfb",
          900: "#1c1917",
        },
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.3s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;