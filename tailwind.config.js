/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Read from CSS variables so the Dark / Light switch can change them.
        dark: { 950: 'rgb(var(--dk-950) / <alpha-value>)', 900: 'rgb(var(--dk-900) / <alpha-value>)', 850: 'rgb(var(--dk-850) / <alpha-value>)', 800: 'rgb(var(--dk-800) / <alpha-value>)', 750: 'rgb(var(--dk-750) / <alpha-value>)', 700: 'rgb(var(--dk-700) / <alpha-value>)', 600: 'rgb(var(--dk-600) / <alpha-value>)', 500: 'rgb(var(--dk-500) / <alpha-value>)' },
        slate: { 50: 'rgb(var(--sl-50) / <alpha-value>)', 100: 'rgb(var(--sl-100) / <alpha-value>)', 200: 'rgb(var(--sl-200) / <alpha-value>)', 300: 'rgb(var(--sl-300) / <alpha-value>)', 400: 'rgb(var(--sl-400) / <alpha-value>)', 500: 'rgb(var(--sl-500) / <alpha-value>)', 600: 'rgb(var(--sl-600) / <alpha-value>)', 700: 'rgb(var(--sl-700) / <alpha-value>)', 800: 'rgb(var(--sl-800) / <alpha-value>)', 900: 'rgb(var(--sl-900) / <alpha-value>)' },
        solar: { amber: 'rgb(var(--ac-500) / <alpha-value>)', gold: 'rgb(var(--ac-400) / <alpha-value>)', glow: 'rgb(var(--ac-600) / <alpha-value>)' },
        brand: { blue: '#2563eb', cyan: '#06b6d4', emerald: '#10b981', rose: '#f43f5e' },
      },
      boxShadow: { card: '0 1px 2px rgb(var(--shadow) / 0.06), 0 4px 16px rgb(var(--shadow) / 0.08)', pop: '0 12px 40px rgb(var(--shadow) / 0.28)' },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'], mono: ['JetBrains Mono', 'Consolas', 'Courier New', 'monospace'] },
    },
  },
  plugins: [],
};
