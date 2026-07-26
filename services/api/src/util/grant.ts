import type { GrantTokenData, Logger } from '@chatsift/backend-core';
import { releaseGrantToken } from '@chatsift/backend-core';

/**
 * Releases `grant`'s claim (if any) so a correctable mistake (bad input, a transient Discord/DB error) doesn't
 * permanently burn the user's single-use link -- shared by every route that sets `claimsGrant: true` on `isAuthed`
 * (`createSnippet`, `updateConfig`). Best-effort: a release failure (e.g. redis being down) is logged, not thrown,
 * so it never shadows the real error the caller is already handling.
 */
export async function releaseGrantOnError(grant: GrantTokenData | undefined, logger: Logger): Promise<void> {
	if (!grant) {
		return;
	}

	await releaseGrantToken(grant.jti).catch((releaseError: unknown) =>
		logger.error({ err: releaseError }, 'failed to release grant token'),
	);
}
