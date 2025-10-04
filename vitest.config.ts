import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: ['**/node_modules', '**/dist', '.idea', '.git', '.cache'],
		passWithNoTests: true,
		typecheck: {
			enabled: true,
			include: ['**/__tests__/types.test.ts'],
			tsconfig: 'tsconfig.json',
		},
		coverage: {
			enabled: true,
			reporter: ['text', 'lcov', 'clover'],
			exclude: [
				'**/dist',
				'**/__tests__',
				'**/__mocks__',
				'**/coverage',
				'**/tsup.config.ts',
				'**/vitest.config.ts',
				'**/.next',
				'eslint.config.js',
				'.yarn',
				'apps/website',
			],
		},
	},
});
