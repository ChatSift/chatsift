import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		exclude: ['**/node_modules', '**/dist', '.idea', '.git', '.cache'],
		passWithNoTests: true,
		typecheck: {
			enabled: true,
			include: ['**/__tests__/types.test.ts'],
		},
		coverage: {
			enabled: true,
			reporter: ['text', 'lcov', 'clover'],
			exclude: ['**/dist', '**/__tests__', '**/__mocks__', '**/tsup.config.ts', '**/vitest.config.ts'],
		},
	},
});
