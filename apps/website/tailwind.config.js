import typographyPlugin from '@tailwindcss/typography';
import tailwindAnimate from 'tailwindcss-animate';
import themer from 'tailwindcss-themer';

/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{js,ts,jsx,tsx}'],
	darkMode: 'class',
	theme: {
		fontSize: {
			xs: ['0.875rem', { lineHeight: '1.25rem' }],
			sm: ['1rem', { lineHeight: '1.5rem' }],
			base: ['1.125rem', { lineHeight: '1.75rem' }],
			lg: ['1.25rem', { lineHeight: '2rem' }],
			xl: ['1.5rem', { lineHeight: '2rem' }],
			'2xl': ['1.875rem', { lineHeight: '2.25rem' }],
			'3xl': ['2.25rem', { lineHeight: '2.5rem' }],
			'4xl': ['2.5rem', { lineHeight: '2.5rem' }],
			'5xl': ['3rem', { lineHeight: '1' }],
			'6xl': ['3.75rem', { lineHeight: '1' }],
			'7xl': ['4.25rem', { lineHeight: '1' }],
			'8xl': ['5rem', { lineHeight: '1' }],
			'9xl': ['7rem', { lineHeight: '1' }],
		},
	},
	plugins: [
		typographyPlugin,
		tailwindAnimate,
		themer({
			defaultTheme: {
				extend: {
					colors: {
						base: {
							DEFAULT: '#F7F8F8',
							100: '#F7F8F8',
							200: '#F2F4F5',
							300: '#EEEFF2',
						},
						primary: '#28292F',
						secondary: 'rgba(26, 30, 51, 0.62)',
						tertiary: 'rgba(22, 30, 66, 0.31)',
						static: 'rgba(19, 29, 81, 0.09)',
						'on-accent': '#EEEFF2',
						accent: {
							DEFAULT: '#0978E5',
							bg: '#74BAFE',
							fg: '#0978E5',
						},
						neutral: {
							DEFAULT: '#717B88',
							bg: '#AEB4C1',
							fg: '#717B88',
						},
						danger: {
							DEFAULT: '#D6453E',
							bg: '#FF9792',
							fg: '#D6453E',
						},
						warning: {
							DEFAULT: '#E5AC0D',
							bg: '#FFE676',
							fg: '#E5AC0D',
						},
						success: {
							DEFAULT: '#3D8940',
							bg: '#5FC974',
							fg: '#3D8940',
						},
					},
				},
			},
			themes: [
				{
					name: 'dark',
					extend: {
						colors: {
							base: {
								DEFAULT: '#111216',
								100: '#111216',
								200: '#1D1E23',
								300: '#28292F',
							},
							primary: '#EEEFF2',
							secondary: 'rgba(224, 229, 244, 0.76)',
							tertiary: 'rgba(211, 219, 246, 0.5)',
							static: 'rgba(197, 209, 247, 0.21)',
							'on-accent': '#28292F',
							accent: {
								DEFAULT: '#74BAFE',
								bg: '#74BAFE',
								fg: '#0978E5',
							},
							neutral: {
								DEFAULT: '#AEB4C1',
								bg: '#AEB4C1',
								fg: '#717B88',
							},
							danger: {
								DEFAULT: '#FF9792',
								bg: '#FF9792',
								fg: '#D6453E',
							},
							warning: {
								DEFAULT: '#FFE676',
								bg: '#FFE676',
								fg: '#E5AC0D',
							},
							success: {
								DEFAULT: '#5FC974',
								bg: '#5FC974',
								fg: '#3D8940',
							},
						},
					},
				},
			],
		}),
	],
};
