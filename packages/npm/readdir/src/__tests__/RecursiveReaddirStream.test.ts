import { join as joinPath } from 'node:path';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { readdirRecurse, readdirRecurseAsync, ReadMode } from '../index.js';

function toPlatformPath(paths: string[]): string[] {
	return paths.map((name) => name.replaceAll(path.posix.sep, path.sep));
}

/**
 * Let's create a mock file system structure
 * test has standard read tests
 * test2 has tests for special cases (EACCESS, internal errors etc)
 * - test
 * - - dir1
 * - - - file1.sh
 * - - - file2.js
 * - - dir2
 * - test2
 * - - dir1 (EACCESS)
 * - - - ?
 */

vi.mock('node:fs/promises', async (importOriginal) => {
	class EAccessError extends Error {
		public constructor() {
			super();
		}

		public readonly code = 'EACCES';
	}

	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const original: typeof import('fs/promises') = await importOriginal();
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports, @typescript-eslint/unbound-method
	const { join: joinPath }: typeof import('path') = await vi.importActual('node:path');

	return {
		...original,
		readdir: vi.fn().mockImplementation(async (path) => {
			switch (path) {
				case joinPath('test'):
					return ['dir1', 'dir2'];
				case joinPath('test', 'dir1'):
					return ['file1.sh', 'file2.js'];
				case joinPath('test', 'dir2'):
					return [];

				case joinPath('test2'):
					return ['dir1'];
				case joinPath('test2', 'dir1'):
					throw new EAccessError();

				default:
					throw new Error(`bad path: ${path}`);
			}
		}),
		stat: vi.fn().mockImplementation(async (path) => {
			/* eslint-disable sonarjs/no-duplicated-branches */
			switch (path) {
				case joinPath('test'):
					return {
						isDirectory() {
							return true;
						},
					};
				case joinPath('test', 'dir1'):
					return {
						isDirectory() {
							return true;
						},
					};
				case joinPath('test', 'dir1', 'file1.sh'):
					return {
						isDirectory() {
							return false;
						},
					};
				case joinPath('test', 'dir1', 'file2.js'):
					return {
						isDirectory() {
							return false;
						},
					};
				case joinPath('test', 'dir2'):
					return {
						isDirectory() {
							return true;
						},
					};

				case joinPath('test2'):
					return {
						isDirectory() {
							return true;
						},
					};
				case joinPath('test2', 'dir1'):
					throw new EAccessError();
				/* eslint-enable sonarjs/no-duplicated-branches */

				default:
					throw new Error(`bad path: ${path}`);
			}
		}),
	};
});

test('async iterator stream consumption', async () => {
	const files: string[] = [];
	for await (const file of readdirRecurse(joinPath('test'), { readMode: ReadMode.both })) {
		files.push(file);
	}

	expect(files).toStrictEqual(toPlatformPath(['test/dir1', 'test/dir2', 'test/dir1/file1.sh', 'test/dir1/file2.js']));
});

test('promise based consumption', async () => {
	expect(await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.both })).toStrictEqual(
		toPlatformPath(['test/dir1', 'test/dir2', 'test/dir1/file1.sh', 'test/dir1/file2.js']),
	);

	const catchCb = vi.fn();

	await readdirRecurseAsync(joinPath('test3'), { readMode: ReadMode.both }).catch(catchCb);

	expect(catchCb).toHaveBeenCalled();
});

test('read modes', async () => {
	expect(await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.file })).toStrictEqual(
		toPlatformPath(['test/dir1/file1.sh', 'test/dir1/file2.js']),
	);

	expect(await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.dir })).toStrictEqual(
		toPlatformPath(['test/dir1', 'test/dir2']),
	);
});

test('file extension filter', async () => {
	expect(
		await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.both, fileExtensions: ['sh'] }),
	).toStrictEqual(toPlatformPath(['test/dir1', 'test/dir2', 'test/dir1/file1.sh']));

	expect(
		await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.file, fileExtensions: ['sh'] }),
	).toStrictEqual(toPlatformPath(['test/dir1/file1.sh']));
});

test('warnings', async () => {
	const onWarn = vi.fn();
	const onError = vi.fn();

	const stream = readdirRecurse(joinPath('test2'), { readMode: ReadMode.both }).on('warn', onWarn).on('error', onError);

	const paths: string[] = [];
	for await (const path of stream) {
		paths.push(path);
	}

	expect(paths).toStrictEqual([]);
	expect(onWarn).toHaveBeenCalledTimes(1);
	expect(onError).not.toHaveBeenCalled();
});

test('fatal errors', async () => {
	const onWarn = vi.fn();
	const onError = vi.fn();

	const paths: string[] = [];

	try {
		const stream = readdirRecurse(joinPath('test3'), { readMode: ReadMode.both })
			.on('warn', onWarn)
			.on('error', onError);

		for await (const path of stream) {
			paths.push(path);
		}
	} catch {}

	expect(paths).toStrictEqual([]);
	expect(onWarn).not.toHaveBeenCalled();
	expect(onError).toHaveBeenCalledTimes(1);
});
