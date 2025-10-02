import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { context } from '../context.js';

/**
 * Returns a base64-encoded string containing the IV and the encrypted given `data`.
 */
export function encrypt(data: string): string {
	const key = Buffer.from(context.env.ENCRYPTION_KEY, 'base64');
	const iv = randomBytes(16);

	const cipher = createCipheriv('aes-256-ctr', key, iv);
	return Buffer.concat([iv, cipher.update(data, 'utf8'), cipher.final()]).toString('base64');
}

/**
 * Decodes a string created by `encrypt` and returns the original data.
 */
export function decrypt(data: string): string {
	const buffer = Buffer.from(data, 'base64');

	const key = Buffer.from(context.env.ENCRYPTION_KEY, 'base64');
	const iv = buffer.subarray(0, 16);

	const decipher = createDecipheriv('aes-256-ctr', key, iv);

	return Buffer.concat([decipher.update(buffer.subarray(16)), decipher.final()]).toString('utf8');
}
