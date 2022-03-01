/* eslint-disable */
module.exports = {
	testMatch: ['**/+(*.)+(spec|test).+(ts)?(x)'],
	testEnvironment: 'node',
	collectCoverage: true,
	coverageDirectory: 'coverage',
	coverageReporters: ['text', 'lcov', 'clover'],
	coverageThreshold: {
		global: {
			branches: 60,
			functions: 60,
			lines: 60,
			statements: 60,
		},
	},
	roots: ['<rootDir>packages/', '<rootDir>services/'],
	coveragePathIgnorePatterns: ['<rootDir>dist/'],
	setupFiles: ['./jest-setup.ts'],
};
