import * as fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as sonicBoom from 'sonic-boom';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { pinoRotateFile } from '../index.js';

function toPlatformPath(name: string): string {
	return name.replaceAll(path.posix.sep, path.sep);
}

function toPlatformPaths(paths: string[]): string[] {
	return paths.map((name) => toPlatformPath(name));
}

vi.useFakeTimers();

const nowMock = vi.fn(() => Date.now());
global.Date.now = nowMock;

const readdirSpy = vi.spyOn(fs, 'readdir') as unknown as Mock<(path: string) => Promise<string[]>>;
const unlinkSpy = vi.spyOn(fs, 'unlink');
const accessSpy = vi.spyOn(fs, 'access');
const mkdirSpy = vi.spyOn(fs, 'mkdir');

vi.mock('node:fs/promises', () => ({
	readdir: vi.fn(async () => []),
	unlink: vi.fn(async () => {}),
	access: vi.fn(async () => {}),
	mkdir: vi.fn(async () => {}),
}));

const sonicBoomConstructorSpy = vi.spyOn(sonicBoom, 'SonicBoom');

vi.mock('sonic-boom', async () => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const { EventEmitter } = await vi.importActual<typeof import('node:events')>('node:events');

	class MockSonicBoom extends EventEmitter {
		public constructor() {
			super();
			// Need to wait an event loop cycle so the `once` call gets to run
			process.nextTick(() => this.emit('ready'));
		}
	}

	return {
		SonicBoom: vi.fn(() => new MockSonicBoom()),
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('initial file creation', () => {
	test('it can create a file if the dir exists', async () => {
		// dir exists
		accessSpy.mockReturnValue(Promise.resolve());
		// no files exist in dir
		readdirSpy.mockReturnValue(Promise.resolve([]));
		nowMock.mockReturnValue(new Date('2022-01-01').getTime());

		await pinoRotateFile({ dir: 'foo' });
		// SonicBoom instance is created with the appropriate destination
		expect(sonicBoomConstructorSpy).toHaveBeenCalledWith({ dest: toPlatformPath('foo/2022-01-01.log') });
	});

	test('it creates the dir if mkdir is true', async () => {
		// dir doesn't exist
		accessSpy.mockImplementation(async () => {
			throw new Error('boom');
		});
		// no files exist in dir
		readdirSpy.mockReturnValue(Promise.resolve([]));
		mkdirSpy.mockImplementation(async () => {
			// Update access implementation to reflect on dir being created
			accessSpy.mockImplementation(async () => {});
			return Promise.resolve() as Promise<undefined>;
		});
		nowMock.mockReturnValue(new Date('2022-01-01').getTime());

		await pinoRotateFile({ dir: 'foo', mkdir: true });
		// mkdir is called with the correct path
		expect(mkdirSpy).toHaveBeenCalledWith('foo', { recursive: true });
		expect(sonicBoomConstructorSpy).toHaveBeenCalledWith({ dest: toPlatformPath('foo/2022-01-01.log') });
	});
});

test('it cleans up', async () => {
	// dir exists
	accessSpy.mockReturnValue(Promise.resolve());
	// few files exist in dir
	readdirSpy.mockReturnValue(Promise.resolve(['2022-01-01.log', '2022-01-02.log', '2022-01-03.log']));
	// We want the first 2 deleted and the last one kept
	nowMock.mockReturnValue(new Date('2022-01-04').getTime());
	await pinoRotateFile({ dir: 'foo', maxAgeDays: 2 });

	// first 2 files were deleted
	expect(unlinkSpy).toHaveBeenCalledTimes(2);
	expect(unlinkSpy).toHaveBeenNthCalledWith(1, toPlatformPath('foo/2022-01-01.log'));
	expect(unlinkSpy).toHaveBeenNthCalledWith(2, toPlatformPath('foo/2022-01-02.log'));
});
