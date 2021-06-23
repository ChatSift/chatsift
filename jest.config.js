/* eslint-disable */
module.exports = {
  testMatch: ['**/+(*.)+(spec|test).+(ts)?(x)'],
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  roots: ['<rootDir>libs/', '<rootDir>services/'],
  coveragePathIgnorePatterns: ['<rootDir>dist/'],
  setupFiles: ['./jest-setup.ts']
};
