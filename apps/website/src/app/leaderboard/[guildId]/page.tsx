import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { PublicLeaderboard } from './_components/PublicLeaderboard';
import { getPublicLeaderboard, getPublicLeaderboardOrNull } from './_lib/publicLeaderboard';
import { prefetch } from '@/api/fetch';
import { queryKeys } from '@/api/queryClient';
import { SITE_NAME, socialMetadata } from '@/utils/site';

/**
 * `noindex` even though this page is genuinely public, unlike `/ama-answers`' -- which is `noindex` because
 * its URL is a capability. Here the reason is what the page contains: a server's members ranked by activity.
 * Whoever switched it on opted into "anyone with the link", not into being a permanent search result their
 * members never agreed to. Unfurlers ignore `robots`, so the embed below still works when the link is pasted
 * into Discord, which is the only place these are ever shared.
 *
 * See `app/robots.ts` for why the path isn't `Disallow`ed instead: a crawler has to be allowed to fetch a page
 * before it can read the `noindex` off it.
 */
export async function generateMetadata({ params }: PageProps<'/leaderboard/[guildId]'>): Promise<Metadata> {
	const { guildId } = await params;
	const data = await getPublicLeaderboardOrNull(guildId);

	if (!data) {
		return { title: 'Leaderboard not found', robots: { index: false, follow: false } };
	}

	const name = data.guildName ?? 'this server';
	return {
		...socialMetadata({
			title: data.guildName ? `${data.guildName} leaderboard` : 'Leaderboard',
			description:
				data.total === 0
					? `The XP leaderboard for ${name} on ${SITE_NAME}. Nobody has earned XP yet.`
					: `${data.total} ranked member${data.total === 1 ? '' : 's'} in ${name} — see the full leaderboard on ${SITE_NAME}.`,
			path: `/leaderboard/${guildId}`,
		}),
		robots: { index: false, follow: false },
	};
}

export default async function PublicLeaderboardPage({ params }: PageProps<'/leaderboard/[guildId]'>) {
	const { guildId } = await params;

	return (
		<HydrationBoundary
			state={await prefetch([
				{
					queryKey: () => queryKeys.social.publicLeaderboardPage(guildId, 0),
					queryFn: async () => getPublicLeaderboard(guildId),
				},
			])}
		>
			<PublicLeaderboard />
		</HydrationBoundary>
	);
}
