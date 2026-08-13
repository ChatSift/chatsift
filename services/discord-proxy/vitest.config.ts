import { createVitestConfig } from '../../vitest.shared';

export default createVitestConfig({ coverageExclude: ['src/bin.ts', 'src/index.ts'] });
