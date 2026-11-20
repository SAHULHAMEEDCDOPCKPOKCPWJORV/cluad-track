/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          950: '#030508',
          900: '#070a10',
          850: '#0c1018',
          800: '#111723',
          750: '#171f2e',
          700: '#1e283b',
          600: '#2d3b52',
          500: '#435472',
        },
        solar: {
          amber: '#f59e0b',
          gold: '#fbbf24',
          glow: '#d97706',
        },
        brand: {
          blue: '#2563eb',
          cyan: '#06b6d4',
          emerald: '#10b981',
          rose: '#f43f5e',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Consolas', 'Courier New', 'monospace'],
      }
    },
  },
  plugins: [],
}
