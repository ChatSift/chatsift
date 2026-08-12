'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { useSocialConfig, useUpdateSocialConfig } from '@/api/routes/social';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';

/**
 * Publishes the guild's leaderboard at `/leaderboard/<guildId>`, readable with no account at all.
 *
 * Deliberately *not* a share link the way an AMA's is. There's one leaderboard per guild and it's already
 * addressed by the guild id, so an unguessable token would only have made the page unlisted -- whoever the
 * link is handed to can forward it either way -- in exchange for a second identifier to store, rotate and keep
 * a realtime channel in step with. The switch is the whole control; the wording below says so rather than
 * implying a private link.
 */
export function PublicLeaderboardCard() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: config, isLoading } = useSocialConfig(guildId);
	const updateConfig = useUpdateSocialConfig(guildId);

	const [actionError, setActionError] = useState<string | null>(null);
	const [linkCopied, setLinkCopied] = useState(false);

	if (isLoading || !config) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const isPublic = config.publicLeaderboard;
	// Built in the browser rather than from an env var so it's whatever origin the dashboard is actually being
	// used on, matching how the AMA share link is copied.
	const url = typeof window === 'undefined' ? '' : `${window.location.origin}/leaderboard/${guildId}`;

	const handleToggle = async () => {
		setActionError(null);

		try {
			await updateConfig.mutateAsync({ publicLeaderboard: !isPublic });
		} catch (error) {
			setActionError(
				error instanceof APIError ? error.message : 'Failed to change the public leaderboard. Please try again.',
			);
		}
	};

	const handleCopy = async () => {
		await navigator.clipboard.writeText(url);
		setLinkCopied(true);
		setTimeout(() => setLinkCopied(false), 2_000);
	};

	return (
		<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
			<div>
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Public page</h2>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
					A read-only copy of this leaderboard that needs no Discord account and no access to the server.
				</p>
			</div>

			{actionError && (
				<p className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger" role="alert">
					{actionError}
				</p>
			)}

			<label className="flex items-center gap-2" htmlFor="social-public-leaderboard">
				<input
					checked={isPublic}
					className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
					disabled={updateConfig.isPending}
					id="social-public-leaderboard"
					onChange={handleToggle}
					type="checkbox"
				/>
				<span className="text-sm font-medium text-secondary dark:text-secondary-dark">
					Anyone with the link can view this leaderboard
				</span>
			</label>

			{isPublic ? (
				<div className="flex flex-wrap items-center gap-3">
					<code className="min-w-0 flex-1 truncate rounded-md bg-on-tertiary px-3 py-2 text-sm text-primary dark:bg-on-tertiary-dark dark:text-primary-dark">
						{url}
					</code>
					<Button
						className="shrink-0 rounded-md bg-misc-accent px-4 py-2 text-sm font-medium text-accent hover:opacity-90"
						onPress={handleCopy}
						type="button"
					>
						Copy link
					</Button>
					{linkCopied && <span className="text-sm text-misc-accent">Copied!</span>}
				</div>
			) : (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					While this is off, the page returns &quot;not found&quot; -- indistinguishable from a server that never set
					Social up, so turning it off gives nothing away either.
				</p>
			)}
		</div>
	);
}
