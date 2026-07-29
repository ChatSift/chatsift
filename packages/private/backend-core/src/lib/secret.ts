import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getContext } from './context.js';

const ALGORITHM = 'aes-256-gcm';
// 96-bit nonce -- the size GCM is designed for; anything else forces a slower internal hash step.
const IV_LENGTH = 12;

function getKey(): Buffer {
	// `ENCRYPTION_KEY` is validated as a 44-char base64 string (32 raw bytes) in env.ts, same key
	// already used to sign session/grant JWTs.
	return Buffer.from(getContext().env.ENCRYPTION_KEY, 'base64');
}

/**
 * Encrypts `plaintext` with AES-256-GCM under `ENCRYPTION_KEY`, for secrets that need to be stored at
 * rest (currently just `modmail_instances.token`, see docs/roadmap/08-modmail-custom-instances.md) --
 * unlike the JWT paths in grantToken.ts/session tokens, this is symmetric encryption for data we need
 * to read back verbatim, not a signed, self-describing token. Output is `iv:authTag:ciphertext`,
 * each segment base64-encoded, so it prints and stores as a single flat string.
 */
export function encryptSecret(plaintext: string): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, getKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Reverses `encryptSecret`. Throws if `encrypted` isn't the `iv:authTag:ciphertext` shape that
 * function produces, or if the auth tag doesn't verify (wrong key, or the ciphertext was tampered
 * with) -- there's no partial/best-effort decrypt to fall back to either way.
 */
export function decryptSecret(encrypted: string): string {
	const [ivPart, authTagPart, ciphertextPart] = encrypted.split(':');
	if (!ivPart || !authTagPart || !ciphertextPart) {
		throw new Error('Malformed encrypted secret: expected "iv:authTag:ciphertext"');
	}

	const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, 'base64'));
	decipher.setAuthTag(Buffer.from(authTagPart, 'base64'));

	return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64')), decipher.final()]).toString('utf8');
}
