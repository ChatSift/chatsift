'use client';

import { useEffect, useState } from 'react';
import { FaClock } from 'react-icons/fa';
import { useMe } from '@/api/routes/auth';
import { LoginButton } from '@/components/user/LoginButton';

function minutesRemaining(expiresAt: string): number {
	return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (60 * 1_000)));
}

/**
 * Shown for the lifetime of a `/dashboard`-minted session (see `middleware/isAuthed.ts`'s `ScopedAccessTokenData`)
 * -- a full OAuth login has no `scopedExpiresAt`, so this renders nothing for the common case. Ticks its
 * remaining-time display once a minute rather than reading a single value at mount, since a session opened
 * from a link can easily be left open for its whole 30-minute window.
 */
export function ScopedSessionBanner() {
	const { data: me } = useMe();
	const scopedExpiresAt = me?.scopedExpiresAt;
	const [minutes, setMinutes] = useState(() => (scopedExpiresAt ? minutesRemaining(scopedExpiresAt) : 0));

	useEffect(() => {
		if (!scopedExpiresAt) {
			return undefined;
		}

		setMinutes(minutesRemaining(scopedExpiresAt));

		const interval = setInterval(() => setMinutes(minutesRemaining(scopedExpiresAt)), 60 * 1_000);
		return () => clearInterval(interval);
	}, [scopedExpiresAt]);

	if (!me?.scopedExpiresAt) {
		return null;
	}

	return (
		<div className="flex flex-wrap items-center gap-3 rounded-lg border border-misc-warning/40 bg-misc-warning/10 px-3 py-2 text-sm text-misc-warning dark:text-misc-warning-dark">
			<FaClock className="h-4 w-4 shrink-0" />
			<p className="flex-1">
				You're viewing <span className="font-medium">{me.guilds[0]?.name}</span> via a temporary{' '}
				<code className="font-mono">/dashboard</code> link.{' '}
				{minutes > 0 ? `This session ends in ${minutes} minute${minutes === 1 ? '' : 's'}.` : 'This session is ending.'}{' '}
				Other servers aren't available this way — you may be unable to manage them until you sign in normally.
			</p>
			<LoginButton label="Sign in with Discord for full access" />
		</div>
	);
}
