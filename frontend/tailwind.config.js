/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js}'],
  theme: {
    extend: {
      colors: {
        /* Electric Lime — primary accents and actions.
         * The scale is tuned for a DARK surface: low values are deep
         * lime-tinted tints used for backgrounds and borders, mid values are
         * the accent itself, high values are light limes used for accent text
         * on navy where the mid tone would not have enough contrast. */
        brand: {
          50: '#16241a',
          100: '#1d3324',
          200: '#2c4d33',
          300: '#4a7a3c',
          400: '#7dbb42',
          500: '#b7f34a',
          600: '#c9f96f',
          700: '#dcfda0',
          800: '#eaffc4',
          900: '#f4ffe3',
        },

        /* Core surfaces, named so components can stop guessing hexes. */
        navy: '#101b2d',
        slate: '#1d2d44',
        card: '#1a2940',
        line: '#26374f',
        muted: '#a6b3c2',
        success: '#45c78a',
        alert: '#ffb547',
        cyan: '#5fd4e8',
        'muted-blue': '#7d9bc4',

        cream: '#101b2d',

        /* Ink — INVERTED for a dark surface.
         * Previously 900 was near-black text and 100 a near-white tint.
         * Now 900 is pure white text and 100 is the card surface, so every
         * existing `text-ink-900` / `bg-ink-100` usage keeps working and
         * simply flips polarity. */
        ink: {
          900: '#ffffff',
          800: '#ebf1f8',
          700: '#d3deea',
          600: '#bcccdd',
          500: '#a6b3c2',
          400: '#8b9bb0',
          300: '#6b7c93',
          200: '#2a3d57',
          100: '#1a2940',
        },
      },
      fontFamily: {
        /* Body copy and buttons */
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        /* Headings and statistics */
        display: ['Space Grotesk', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        /* Soft, subtle elevation. Deep navy base instead of pink. */
        soft: '0 8px 24px -14px rgba(6, 12, 22, 0.55)',
        card: '0 14px 34px -22px rgba(6, 12, 22, 0.68)',
        glow: '0 10px 24px -12px rgba(183, 243, 74, 0.32)',
        inset: 'inset 0 1px 0 0 rgba(255, 255, 255, 0.05)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      backgroundImage: {
        'night-fade': 'linear-gradient(165deg, #101b2d 0%, #132033 45%, #16263c 100%)',
        'brand-gradient': 'linear-gradient(135deg, #b7f34a 0%, #a5e63c 55%, #8fd32c 100%)',
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
