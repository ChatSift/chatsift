import typographyPlugin from '@tailwindcss/typography';
import tailwindAnimate from 'tailwindcss-animate';
import themer from 'tailwindcss-themer';

/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{js,ts,jsx,tsx}'],
	darkMode: 'class',
	plugins: [
		typographyPlugin,
		tailwindAnimate,
		themer({
			defaultTheme: {
				extend: {
					colors: {
						base: '#F1F2F5',
						primary: '#1d274e',
						secondary: 'rgba(29, 39, 78, 0.75)',
						accent: '#ffffff',
						disabled: '#1E284F80',
						on: {
							primary: '#1E284F40',
							secondary: 'rgba(29, 39, 78, 0.15)',
							tertiary: '#1E284F0D',
						},
						misc: {
							accent: '#2f8fee',
							danger: '#ff5052',
						},
					},
				},
			},
			themes: [
				{
					name: 'dark',
					extend: {
						colors: {
							base: '#151519',
							primary: '#F6F6FB',
							secondary: '#F6F6FBB2',
							accent: '#ffffff',
							disabled: '#F5F5FC66',
							on: {
								primary: '#F4F4FD33',
								secondary: '#F4F4FD1A',
								tertiary: '#F4F4FD0D',
							},
							misc: {
								accent: '#2f8fee',
								danger: '#ff5052',
							},
						},
					},
				},
			],
		}),
	],
};
