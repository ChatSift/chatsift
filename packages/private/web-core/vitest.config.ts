import { createVitestConfig } from '../../../vitest.shared';

// Coverage off, matching `apps/website` (#339): these files came from there, and the shared
// `src/**/*.ts` include would not match the `.tsx` half of the package anyway -- so a number here
// would describe an arbitrary subset rather than the package.
export default createVitestConfig({ coverage: false });
