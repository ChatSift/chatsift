import { relative, resolve } from 'node:path';
import process from 'node:process';
import { defineConfig, type Options } from 'tsup';

type ConfigOptions = Pick<
	Options,
	'entry' | 'esbuildOptions' | 'format' | 'globalName' | 'minify' | 'noExternal' | 'sourcemap' | 'target'
>;

export const createTsupConfig = ({
	globalName,
	format = ['esm', 'cjs'],
	target = 'es2021',
	sourcemap = true,
	minify = false,
	entry = ['src/index.ts'],
	noExternal,
	esbuildOptions = (options, context) => {
		if (context.format === 'cjs') {
			options.banner = {
				js: '"use strict";',
			};
		}
	},
}: ConfigOptions = {}) =>
	defineConfig({
		clean: true,
		entry,
		format,
		minify,
		skipNodeModulesBundle: true,
		sourcemap,
		target,
		tsconfig: relative(__dirname, resolve(process.cwd(), 'tsconfig.json')),
		keepNames: true,
		globalName,
		noExternal,
		esbuildOptions,
	});
