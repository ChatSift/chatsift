import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getContext } from '@chatsift/backend-core';

// GCM's recommended nonce size -- using 16 (like a CBC/CTR IV) works but wastes bytes and is slightly slower.
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Returns a base64-encoded string containing the IV, auth tag, and the encrypted given `data`.
 */
export function encrypt(data: string): string {
	const key = Buffer.from(getContext().env.ENCRYPTION_KEY, 'base64');
	const iv = randomBytes(IV_LENGTH);

	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);

	return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64');
}

/**
 * Decodes a string created by `encrypt` and returns the original data. Throws if the ciphertext or auth tag was
 * tampered with (GCM is authenticated, unlike the CTR mode this used to run in).
 */
export function decrypt(data: string): string {
	const buffer = Buffer.from(data, 'base64');

	const key = Buffer.from(getContext().env.ENCRYPTION_KEY, 'base64');
	const iv = buffer.subarray(0, IV_LENGTH);
	const authTag = buffer.subarray(buffer.length - AUTH_TAG_LENGTH);
	const ciphertext = buffer.subarray(IV_LENGTH, buffer.length - AUTH_TAG_LENGTH);

	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(authTag);

	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
