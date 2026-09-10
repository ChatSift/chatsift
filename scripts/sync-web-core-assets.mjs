import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `@chatsift/web-core` owns the shared static bytes -- the Author font files, because it also owns the
// `@font-face` rules in `styles/author.css` that reference them, and the favicon, because it owns the mark.
// Keeping each with its owner is what stops them drifting as a second app appears. But they are referenced
// root-absolute (`/assets/fonts/...`, `/assets/favicon.ico`), and Next serves `public/` per app, so every
// consuming app needs its own copy of the bytes.
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
const assets = join(root, 'packages/private/web-core/assets');

/**
 * `[source, destination]`, both relative to the package's `assets/` and to an app's `public/`.
 *
 * `brand/favicon.ico` is here for the same reason the fonts are: it is ChatSift's mark, both apps show it in
 * the tab, and one owner beats two copies drifting. It lands at `assets/favicon.ico` rather than at the
 * conventional `public/favicon.ico` because that is where the dashboard's `icons` metadata has always pointed
 * -- and Next's own root-`favicon.ico` file convention would take precedence over the metadata if one ever
 * appeared, which is a conflict worth not creating.
 */
const SYNCED = [
	['fonts', 'assets/fonts'],
	['brand/favicon.ico', 'assets/favicon.ico'],
];

const apps = process.argv.slice(2);
if (apps.length === 0) {
	throw new Error('sync-web-core-assets: pass at least one app directory name, e.g. `website`');
}

await Promise.all(
	apps.flatMap((app) =>
		SYNCED.map(async ([source, target]) => {
			const destination = join(root, 'apps', app, 'public', target);
			await mkdir(dirname(destination), { recursive: true });
			await cp(join(assets, source), destination, { force: true, recursive: true });
		}),
	),
);
