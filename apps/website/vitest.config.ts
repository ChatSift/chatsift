import { createVitestConfig } from '../../vitest.shared';

// The dashboard is deliberately not unit-tested (#339), so a coverage report over it would be noise -- and the
// shared `src/**/*.ts` include wouldn't match its `.tsx` files anyway. `turbo.json` here drops the `coverage/**`
// output to match.
export default createVitestConfig({ coverage: false });
