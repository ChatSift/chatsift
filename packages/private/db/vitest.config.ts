import { createVitestConfig } from '../../../vitest.shared';

export default createVitestConfig({ coverageExclude: ['src/generated/**', 'src/scripts/**'] });
