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
    },
  },
  plugins: [],
};
export default config;