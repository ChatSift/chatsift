import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `@chatsift/web-core` owns the Author font files, because it also owns the `@font-face` rules in
// `styles/author.css` that reference them -- keeping the two together is what stops them drifting as a second
// app appears. But those rules resolve root-absolute (`/assets/fonts/...`), and Next serves `public/` per app,
// so every consuming app needs the bytes under its own `public/`.
//
// Root-absolute is not a style choice: Tailwind inlines `author.css` into the importing stylesheet and does
// NOT rebase relative `url()`, so a relative path here would resolve against the app's `styles/` directory and
// 404 -- silently, since a missing @font-face src just falls back to the next font in the stack.
//
// The copies are gitignored, and every entrypoint that serves the app regenerates them -- `build`, `dev` AND
// `start`. `start` is included deliberately even though it normally follows `build` in the same tree: making it
// depend on that ordering is what would turn a fresh-checkout deploy into a silent 404 for every @font-face
// src, and a missing src falls back down the stack rather than erroring.
//
// If anyone ever sets `output: 'standalone'` in an app's next.config.mjs, re-check this: standalone does not
// copy `public/` into the output, so the deploy step would have to carry the synced fonts itself.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'packages/private/web-core/assets/fonts');

const apps = process.argv.slice(2);
if (apps.length === 0) {
	throw new Error('sync-web-core-assets: pass at least one app directory name, e.g. `website`');
}

await Promise.all(
	apps.map(async (app) => {
		const destination = join(root, 'apps', app, 'public/assets/fonts');
		await mkdir(dirname(destination), { recursive: true });
		await cp(source, destination, { force: true, recursive: true });
	}),
);
