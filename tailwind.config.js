/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#090d16",
        foreground: "#f8fafc",
        card: {
          DEFAULT: "#0f172a",
          foreground: "#f1f5f9",
          border: "#1e293b",
        },
        brand: {
          primary: "#10b981", // Emerald
          secondary: "#06b6d4", // Cyan
          danger: "#ef4444", // Red
          warning: "#f59e0b", // Yellow
          muted: "#64748b",
        }
      },
    },
  },
  plugins: [],
}
