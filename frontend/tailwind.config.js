/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff5f9',
          100: '#ffe6f1',
          200: '#ffcfe4',
          300: '#ffa9cd',
          400: '#ff7bb2',
          500: '#f9569b',
          600: '#ec4899',
          700: '#db2777',
          800: '#be185d',
          900: '#9d174d',
        },
        cream: '#fffaf8',
        ink: {
          900: '#3f2333',
          700: '#5c3a4c',
          500: '#8a6473',
          400: '#a98595',
        },
      },
      fontFamily: {
        sans: ['Quicksand', 'Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'Quicksand', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(236, 72, 153, 0.25)',
        card: '0 18px 40px -24px rgba(190, 24, 93, 0.35)',
        glow: '0 12px 28px -10px rgba(236, 72, 153, 0.55)',
        inset: 'inset 0 1px 0 0 rgba(255,255,255,0.7)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      backgroundImage: {
        'pink-fade': 'linear-gradient(160deg, #fff7fa 0%, #ffe9f2 45%, #ffdcea 100%)',
        'brand-gradient': 'linear-gradient(135deg, #ff8fbe 0%, #f9569b 55%, #ec4899 100%)',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        pop: {
          '0%': { transform: 'scale(0.94)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(14px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
      },
      animation: {
        float: 'float 5s ease-in-out infinite',
        pop: 'pop 0.25s ease-out',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
        wiggle: 'wiggle 2.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
