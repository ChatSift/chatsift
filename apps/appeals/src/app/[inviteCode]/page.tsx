'use client';

import { Heading } from '@chatsift/web-core/components/Heading';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useEffect } from 'react';
import { useMe, useResolveInvite } from '@/api/routes/appeals';
import { SignInPrompt } from '@/components/SignInPrompt';

/**
 * Decision 12's second entry point: swap `discord.gg` for `unban.app` in an invite the appellant already has.
 *
 * A catch-all at the site root, so it has to **lose to every real route** -- and it does, structurally rather
 * than by ordering: `/g/...` and `/appeals` are static segments, which the App Router matches ahead of a
 * dynamic one, and the auth callbacks live on the API's origin entirely. Anything left over lands here and
 * either resolves to a guild or 404s cleanly.
 *
 * A client component, not a server one: resolving an invite needs the appellant's session, which means signing
 * in first is a real outcome of opening this URL rather than an error.
 */
export default function InvitePage({ params }: { readonly params: Promise<{ inviteCode: string }> }) {
	const { inviteCode } = use(params);
	const router = useRouter();
	const { data: user, isPending: isUserPending } = useMe();
	const { data, isPending, error } = useResolveInvite(inviteCode, Boolean(user));

	useEffect(() => {
		if (data) {
			// Replaced, not pushed: the invite URL is a redirector, so leaving it in history would make Back from
			// the appeal form bounce straight forward again.
			router.replace(`/g/${data.guildId}`);
		}
	}, [data, router]);

	if (isUserPending) {
		return <Skeleton className="h-40 w-full" />;
	}

	if (!user) {
		return (
			<SignInPrompt
				// Not `/${inviteCode}`: this route is off the redirect allowlist by design, so the sanitizer would
				// drop it and land them on the landing page with the invite lost. `InviteHandoff` picks this up.
				redirectTo={`/?invite=${encodeURIComponent(inviteCode)}`}
				subtitle="Sign in with the Discord account that was banned, and we will take you straight to that server's appeal form."
				title="Appeal a Discord ban"
			/>
		);
	}

	if (isPending || data) {
		return <Skeleton className="h-40 w-full" />;
	}

	// `null` covers all three ways an invite can fail to lead anywhere -- expired, never real, or a server that
	// does not use Appeals. The API answers each with a 404 on purpose, so this page cannot be used to find out
	// which, and neither can the copy below.
	return (
		<>
			<Heading
				subtitle={
					error
						? 'We could not check that invite right now. Try again in a few minutes.'
						: 'That invite is expired, is not a server invite, or leads to a server that does not accept appeals here.'
				}
				title="That link did not lead anywhere"
			/>
			<Link className={buttonClass('secondary')} href="/">
				Try another link
			</Link>
		</>
	);
}
