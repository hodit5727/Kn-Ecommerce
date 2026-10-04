/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        burgundy: {
          DEFAULT: '#800020',
          50: '#FDF2F4',
          100: '#FCE7EB',
          200: '#F7C5CE',
          300: '#EE96A5',
          400: '#D45060', // Rose Red accent
          500: '#B01836',
          600: '#940C29',
          700: '#800020', // Primary Deep Burgundy
          800: '#67001A',
          900: '#520015',
          950: '#32000D',
        },
        cream: {
          DEFAULT: '#F3E6D5',
          50: '#FCFAF7',
          100: '#F8F3EC',
          200: '#F3E6D5', // Warm Cream
          300: '#E7D1B7',
          400: '#D7B692',
          500: '#C2986D',
        },
        ivory: {
          DEFAULT: '#FFF9F2', // Soft Ivory
          50: '#FFFEFC',
          100: '#FFFDF9',
          200: '#FFF9F2',
          300: '#FFF2E3',
          400: '#FFE9D1',
        },
        rosered: {
          DEFAULT: '#D45060',
          50: '#FDF2F4',
          100: '#FCE7EB',
          500: '#D45060',
          600: '#BC3849',
          700: '#9B2635',
        }
      },
      fontFamily: {
        serif: ['Cinzel', 'Playfair Display', 'Georgia', 'serif'],
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.03)',
        'premium': '0 10px 30px -5px rgba(128, 0, 32, 0.06), 0 4px 12px -2px rgba(0, 0, 0, 0.04)',
        'airboard': '0 20px 40px -10px rgba(128, 0, 32, 0.08), 0 8px 16px -4px rgba(0, 0, 0, 0.04)',
      },
      animation: {
        'float-slow': 'float 6s ease-in-out infinite',
        'pulse-subtle': 'pulseSubtle 3s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-14px)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.85' },
        }
      }
    },
  },
  plugins: [],
}
