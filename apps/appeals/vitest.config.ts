import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createVitestConfig } from '../../vitest.shared';

// Same shape and the same reasoning as `apps/website`'s: coverage off, because the pages themselves are
// deliberately not unit-tested and a report over them would be noise; the `@/` alias restated, because vite
// does not read `tsconfig.json`'s `paths` the way Next does.
export default mergeConfig(
	createVitestConfig({ coverage: false }),
	defineConfig({
		resolve: { alias: { '@': fileURLToPath(new URL('src', import.meta.url)) } },
	}),
);
