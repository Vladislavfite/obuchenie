/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef5ff', 100: '#d9e8ff', 200: '#bcd7ff', 300: '#8ebdff',
          400: '#5998ff', 500: '#3172f5', 600: '#1e54db', 700: '#1a43b0',
          800: '#1b3a8b', 900: '#1c356f',
        },
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
