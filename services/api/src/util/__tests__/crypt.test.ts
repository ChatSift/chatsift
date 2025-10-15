import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { encrypt, decrypt } from '../crypt.js';

vi.mock('crypto', async () => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const original: typeof import('crypto') = await vi.importActual('crypto');
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
	expect(SECRET_DATA).toBe('AQEBAQEBAQEBAQEBAQEBAejE/bWU7BLYic/V/zbJLfwqp2c5B/8=');
});

test('decrypt', () => {
	expect(decrypt(SECRET_DATA)).toBe(PLAIN_DATA);
});
