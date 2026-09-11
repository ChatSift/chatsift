import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// GCM's recommended nonce size -- using 16 (like a CBC/CTR IV) works but wastes bytes and is slightly slower.
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * AES-256-GCM over an explicitly-passed key, which is the whole reason these live here rather than in
 * `@chatsift/backend-core` beside the wrappers that read `ENCRYPTION_KEY` off the request context.
 *
 * The one-off migration scripts in `../scripts/` have to write `automoderator_log_webhooks.webhook_token`
 * (#11 P9), which is encrypted at rest -- and they deliberately don't pull in `backend-core`, which couldn't
 * depend on them anyway since it already depends on this package. Duplicating twenty lines of cipher code into
 * the scripts would mean two implementations of one wire format, and the failure mode of them drifting is a
 * column the API can no longer decrypt. So the primitives live at the layer both sides already share, and
 * `backend-core`'s `encrypt`/`decrypt` are thin wrappers that supply the key.
 *
 * The key is a base64-encoded 32 bytes, matching `ENCRYPTION_KEY`.
 */
export function encryptWithKey(key: string, data: string): string {
	const iv = randomBytes(IV_LENGTH);

	const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
	const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);

	return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64');
}

/**
 * Decodes a string produced by {@link encryptWithKey}. Throws if the ciphertext or auth tag was tampered with
 * (GCM is authenticated, unlike the CTR mode this used to run in).
 */
export function decryptWithKey(key: string, data: string): string {
	const buffer = Buffer.from(data, 'base64');

	const iv = buffer.subarray(0, IV_LENGTH);
	const authTag = buffer.subarray(buffer.length - AUTH_TAG_LENGTH);
	const ciphertext = buffer.subarray(IV_LENGTH, buffer.length - AUTH_TAG_LENGTH);

	const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
	decipher.setAuthTag(authTag);

	return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
