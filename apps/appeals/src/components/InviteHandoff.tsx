'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Carries an invite code across the login round trip.
 *
 * `/<inviteCode>` is a catch-all at the site root, so it is deliberately **not** on
 * `sanitizeAppealsRedirectTo`'s allowlist -- allowlisting it would allowlist every path on the site. That left
 * the one entry point aimed squarely at logged-out people (decision 12: swap `discord.gg` for `unban.app` in a
 * link you already have) unable to return to itself after signing in: the sanitizer fell back to `/` and the
 * code was lost, so the appellant had to find and paste the invite again.
 *
 * So the invite page sends login to `/?invite=<code>` instead. `/` *is* allowlisted, the sanitizer preserves the
 * query string, and this forwards it back onto the real route on arrival. Nothing about the allowlist has to
 * loosen.
 */
export function InviteHandoff() {
	const router = useRouter();
	const code = useSearchParams().get('invite');

	useEffect(() => {
		if (code) {
			// `replace`, so Back from the appeal form does not land on a URL that immediately forwards again.
			router.replace(`/${encodeURIComponent(code)}`);
		}
	}, [code, router]);

	return null;
}
