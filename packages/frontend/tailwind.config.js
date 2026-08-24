/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Paleta de logos e identidad visual/nineteen_print_brand_identity.html
      // Prefijo np- para no chocar con los teal/amber por default de Tailwind.
      colors: {
        "np-teal": {
          DEFAULT: "#0F6E56",
          dark: "#08402F",
          light: "#E1F5EE",
        },
        "np-amber": {
          DEFAULT: "#E8A020",
          light: "#FFF3DC",
        },
        "np-ink": "#0A2419",
        "np-paper": "#F5F5F2",
      },
      fontFamily: {
        sans: ["Montserrat", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
