import { join as joinPath } from 'path';
import { readdirRecurse, readdirRecurseAsync, ReadMode } from '../';

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

jest.mock('fs/promises', () => {
	class EAccessError extends Error {
		public constructor() {
			super();
		}

		public readonly code = 'EACCES';
	}

	const original: typeof import('fs/promises') = jest.requireActual('fs/promises');
	const { join: joinPath }: typeof import('path') = jest.requireActual('path');

	return {
		...original,
		readdir: jest.fn<Promise<string[]>, [string]>().mockImplementation(async (path) => {
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
					return Promise.reject(new EAccessError());

				default:
					return Promise.reject(new Error(`bad path: ${path}`));
			}
		}),
		stat: jest.fn<Promise<{ isDirectory: () => boolean }>, [string]>().mockImplementation(async (path) => {
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
					return Promise.reject(new EAccessError());

				default:
					return Promise.reject(new Error(`bad path: ${path}`));
			}
		}),
	};
});

test('async iterator stream consumption', async () => {
	const files = [];
	for await (const file of readdirRecurse(joinPath('test'), { readMode: ReadMode.both })) {
		files.push(file);
	}

	expect(files).toStrictEqual(['test/dir1', 'test/dir2', 'test/dir1/file1.sh', 'test/dir1/file2.js']);
});

test('promise based consumption', async () => {
	expect(await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.both })).toStrictEqual([
		'test/dir1',
		'test/dir2',
		'test/dir1/file1.sh',
		'test/dir1/file2.js',
	]);

	const catchCb = jest.fn();

	await readdirRecurseAsync(joinPath('test3'), { readMode: ReadMode.both }).catch(catchCb);

	expect(catchCb).toHaveBeenCalled();
});

test('read modes', async () => {
	expect(await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.file })).toStrictEqual([
		'test/dir1/file1.sh',
		'test/dir1/file2.js',
	]);

	expect(await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.dir })).toStrictEqual([
		'test/dir1',
		'test/dir2',
	]);
});

test('file extension filter', async () => {
	expect(
		await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.both, fileExtensions: ['sh'] }),
	).toStrictEqual(['test/dir1', 'test/dir2', 'test/dir1/file1.sh']);

	expect(
		await readdirRecurseAsync(joinPath('test'), { readMode: ReadMode.file, fileExtensions: ['sh'] }),
	).toStrictEqual(['test/dir1/file1.sh']);
});

test('warnings', async () => {
	const onWarn = jest.fn();
	const onError = jest.fn();

	const stream = readdirRecurse(joinPath('test2'), { readMode: ReadMode.both }).on('warn', onWarn).on('error', onError);

	const paths = [];
	for await (const path of stream) {
		paths.push(path);
	}

	expect(paths).toStrictEqual([]);
	expect(onWarn).toHaveBeenCalledTimes(1);
	expect(onError).not.toHaveBeenCalled();
});

test('fatal errors', async () => {
	const onWarn = jest.fn();
	const onError = jest.fn();

	const paths = [];

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
