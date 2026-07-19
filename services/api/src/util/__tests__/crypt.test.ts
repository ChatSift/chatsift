import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { encrypt, decrypt } from '../crypt.js';

vi.mock('node:crypto', async () => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const original: typeof import('node:crypto') = await vi.importActual('node:crypto');
	// eslint-disable-next-line unicorn/consistent-function-scoping
	const randomBytes = (len: number) => Buffer.from(Array.from<number>({ length: len }).fill(1));
	return {
		...original,
		randomBytes,
	};
});

vi.mock('@chatsift/backend-core', () => ({
	getContext: () => ({
		env: {
			ENCRYPTION_KEY: randomBytes(32).toString('base64'),
		},
	}),
}));

const PLAIN_DATA = 'this is very sensitive';
const SECRET_DATA = encrypt(PLAIN_DATA);

test('encrypt', () => {
	expect(SECRET_DATA).toBe('AQEBAQEBAQEBAQEBxhHT6UmedtOcwH3kjk8rx25dGm0nmvgZCTvVe5nywNNkdnnVyms=');
});

test('decrypt', () => {
	expect(decrypt(SECRET_DATA)).toBe(PLAIN_DATA);
});
