import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createVitestConfig } from '../../vitest.shared';

// The dashboard is deliberately not unit-tested (#339), so a coverage report over it would be noise -- and the
// shared `src/**/*.ts` include wouldn't match its `.tsx` files anyway. `turbo.json` here drops the `coverage/**`
// output to match.
//
// The `@/` alias has to be restated for vitest: Next resolves it from `tsconfig.json`'s `paths`, which vite does
// not read. Without it the handful of pure-logic modules that *are* tested can only import each other by
// relative path -- fine until one of them imports a shared util through the alias every other file in the app
// uses, at which point the test fails with "cannot find package '@/...'" rather than anything naming the real
// problem.
//
// `mergeConfig` rather than an object spread: spreading loses vitest's named return type, and the declaration
// emit then fails with TS2883 because the inferred shape can't be named without importing vitest's internals.
export default mergeConfig(
	createVitestConfig({ coverage: false }),
	defineConfig({
		resolve: { alias: { '@': fileURLToPath(new URL('src', import.meta.url)) } },
	}),
);
