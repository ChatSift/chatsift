import { defineConfig } from 'vitest/config';

interface VitestConfigOptions {
	/**
	 * Whether to collect coverage at all. Only `apps/website` opts out.
	 */
	readonly coverage?: boolean;
	/**
	 * Package-relative paths to keep out of the coverage report, on top of the shared ones.
	 */
	readonly coverageExclude?: readonly string[];
}

/**
 * Shared vitest config every workspace re-exports, mirroring `createTsupConfig`. Each package runs its own
 * `vitest run` so turbo can cache the task per package (#346), which means every glob in here has to be
 * package-relative rather than repo-relative.
 */
export const createVitestConfig = ({ coverage = true, coverageExclude = [] }: VitestConfigOptions = {}) =>
	defineConfig({
		test: {
			exclude: ['**/node_modules', '**/dist', '.idea', '.git', '.cache'],
			passWithNoTests: true,
			typecheck: {
				enabled: true,
				include: ['**/__tests__/types.test.ts'],
				tsconfig: 'tsconfig.json',
			},
			coverage: {
				enabled: coverage,
				reporter: ['text', 'lcov', 'clover'],
				// Without this, vitest only reports on files some test happened to *import* -- a file nothing
				// imports is absent from the report entirely rather than sitting at 0%, which made the numbers
				// describe the test suite instead of the codebase (#339).
				include: ['src/**/*.ts'],
				exclude: ['**/__tests__', '**/__mocks__', ...coverageExclude],
			},
		},
	});
