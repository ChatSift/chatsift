import typographyPlugin from '@tailwindcss/typography';
import type { Config } from 'tailwindcss';
import tailwindAnimate from 'tailwindcss-animate';

const config: Config = {
	content: [
		'./src/pages/**/*.{js,ts,jsx,tsx,mdx}',
		'./src/components/**/*.{js,ts,jsx,tsx,mdx}',
		'./src/app/**/*.{js,ts,jsx,tsx,mdx}',
	],
	darkMode: 'class',
	theme: {
		colors: {
			base: {
				DEFAULT: '#F1F2F5',
				dark: '#151519',
			},
			primary: {
				DEFAULT: '#1d274e',
				dark: '#F6F6FB',
			},
			secondary: {
				DEFAULT: 'rgba(29, 39, 78, 0.75)',
				dark: '#F6F6FBB2',
			},
			accent: '#ffffff',
			disabled: {
				DEFAULT: '#1E284F80',
				dark: '#F5F5FC66',
			},
			on: {
				primary: {
					DEFAULT: '#1E284F40',
					dark: '#F4F4FD33',
				},
				secondary: {
					DEFAULT: 'rgba(29, 39, 78, 0.15)',
					dark: '#F4F4FD1A',
				},
				tertiary: {
					DEFAULT: '#1E284F0D',
					dark: '#F4F4FD0D',
				},
			},
			misc: {
				accent: '#2f8fee',
				danger: '#ff5052',
			},
			card: {
				DEFAULT: '#FFFFFF',
				dark: '#1C1C21',
			},
		},
	},
	plugins: [typographyPlugin, tailwindAnimate],
};

export default config;
