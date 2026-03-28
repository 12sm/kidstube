/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        yt: {
          bg: '#0f0f0f',
          surface: '#1a1a1a',
          card: '#212121',
          border: '#303030',
          text: '#f1f1f1',
          muted: '#aaaaaa',
          red: '#ff0000',
          hover: '#272727'
        }
      },
      fontFamily: {
        sans: ['Roboto', 'Arial', 'sans-serif']
      }
    }
  },
  plugins: []
};
