import { decryptWithKey, encryptWithKey } from '@chatsift/db';
import { getContext } from './context.js';

/**
 * Returns a base64-encoded string containing the IV, auth tag, and the encrypted given `data`.
 *
 * The cipher itself lives in `@chatsift/db` so the one-off migration scripts there can write the same format
 * without a context to read `ENCRYPTION_KEY` from; this pair is the ambient-key form every service uses.
 */
export function encrypt(data: string): string {
	return encryptWithKey(getContext().env.ENCRYPTION_KEY, data);
}

/**
 * Decodes a string created by `encrypt` and returns the original data. Throws if the ciphertext or auth tag was
 * tampered with (GCM is authenticated, unlike the CTR mode this used to run in).
 */
export function decrypt(data: string): string {
	return decryptWithKey(getContext().env.ENCRYPTION_KEY, data);
}
