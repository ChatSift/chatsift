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

// Mirrors the `[iv(12) | ciphertext | authTag(16)]` layout `crypt.ts` encodes into the base64 output.
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function flipByte(base64Data: string, index: number): string {
	const buffer = Buffer.from(base64Data, 'base64');
	buffer[index] = buffer[index]! ^ 0xff;
	return buffer.toString('base64');
}

test('encrypt', () => {
	expect(SECRET_DATA).toBe('AQEBAQEBAQEBAQEBxhHT6UmedtOcwH3kjk8rx25dGm0nmvgZCTvVe5nywNNkdnnVyms=');
});

test('decrypt', () => {
	expect(decrypt(SECRET_DATA)).toBe(PLAIN_DATA);
});

test('decrypt throws when a ciphertext byte has been tampered with', () => {
	const tampered = flipByte(SECRET_DATA, IV_LENGTH);
	expect(() => decrypt(tampered)).toThrow();
});

test('decrypt throws when an auth tag byte has been tampered with', () => {
	const bufferLength = Buffer.from(SECRET_DATA, 'base64').length;
	const tampered = flipByte(SECRET_DATA, bufferLength - AUTH_TAG_LENGTH);
	expect(() => decrypt(tampered)).toThrow();
});
