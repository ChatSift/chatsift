import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { decryptSecret, encryptSecret } from '../secret.js';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

vi.mock('../context.js', () => ({
	getContext: () => ({ env: { ENCRYPTION_KEY } }),
}));

test('decryptSecret reverses encryptSecret', () => {
	const plaintext = 'a-real-bot-token.for-testing';
	const encrypted = encryptSecret(plaintext);

	expect(encrypted).not.toBe(plaintext);
	expect(decryptSecret(encrypted)).toBe(plaintext);
});

test('encryptSecret produces a distinct iv per call, even for the same plaintext', () => {
	const plaintext = 'same-input';
	const first = encryptSecret(plaintext);
	const second = encryptSecret(plaintext);

	expect(first).not.toBe(second);
	expect(decryptSecret(first)).toBe(plaintext);
	expect(decryptSecret(second)).toBe(plaintext);
});

test('decryptSecret throws on a malformed input', () => {
	expect(() => decryptSecret('not-the-right-shape')).toThrow();
});

test('decryptSecret throws when the ciphertext was tampered with', () => {
	const encrypted = encryptSecret('a-real-bot-token-long-enough-to-flip-a-byte-safely');
	const [iv, authTag, ciphertext] = encrypted.split(':');

	// Flip one whole byte (not just the trailing base64 character, whose low bits can be redundant
	// padding that decodes back to the same byte) so this can't spuriously pass GCM's auth check.
	const bytes = Buffer.from(ciphertext!, 'base64');
	bytes[0] = bytes[0]! ^ 0xff;
	const tampered = `${iv}:${authTag}:${bytes.toString('base64')}`;

	expect(() => decryptSecret(tampered)).toThrow();
});
