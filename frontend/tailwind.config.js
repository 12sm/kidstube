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
          bg:      'rgb(var(--yt-bg) / <alpha-value>)',
          surface: 'rgb(var(--yt-surface) / <alpha-value>)',
          card:    'rgb(var(--yt-card) / <alpha-value>)',
          border:  'rgb(var(--yt-border) / <alpha-value>)',
          text:    'rgb(var(--yt-text) / <alpha-value>)',
          muted:   'rgb(var(--yt-muted) / <alpha-value>)',
          red:     '#ff0000',
          hover:   'rgb(var(--yt-hover) / <alpha-value>)',
        }
      },
      fontFamily: {
        sans: ['Roboto', 'Arial', 'sans-serif']
      }
    }
  },
  plugins: []
};
