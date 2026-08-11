import { HydrationBoundary } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { PublicAnswers } from './_components/PublicAnswers';
import { getPublicAnswers, getPublicAnswersOrNull } from './_lib/publicAnswers';
import { prefetch } from '@/api/fetch';
import { queryKeys } from '@/api/queryClient';
import { SITE_NAME, socialMetadata } from '@/utils/site';

/**
 * This is the one ChatSift URL people deliberately paste into Discord, so it's the one that most needs a real
 * embed rather than the site-wide default (#295) -- title of the actual AMA, and how much there is to read.
 */
export async function generateMetadata({ params }: PageProps<'/ama-answers/[shareToken]'>): Promise<Metadata> {
	const { shareToken } = await params;
	const data = await getPublicAnswersOrNull(shareToken);

	if (!data) {
		return { title: 'AMA not found', robots: { index: false, follow: false } };
	}

	const answered = data.questions.length;
	return {
		...socialMetadata({
			title: data.title,
			description:
				answered === 0
					? `An AMA on ${SITE_NAME}. No questions have been answered yet.`
					: `${answered} answered question${answered === 1 ? '' : 's'} — read the full AMA on ${SITE_NAME}.`,
			path: `/ama-answers/${shareToken}`,
			hasOwnImage: true,
		}),
		// The share token is a capability, not a public identifier: holding the link is the whole access check.
		// Unfurlers ignore `robots` (so the embed above still works), but a search engine indexing one of these
		// would hand the link to everyone who never had it. `app/robots.ts` disallows the path too -- that only
		// stops crawling, which isn't enough on its own for a URL someone else has linked publicly.
		robots: { index: false, follow: false },
	};
}

export default async function AMAPublicAnswersPage({ params }: PageProps<'/ama-answers/[shareToken]'>) {
	const { shareToken } = await params;

	return (
		<HydrationBoundary
			state={await prefetch([
				{
					queryKey: () => queryKeys.ama.publicAnswers(shareToken),
					queryFn: async () => getPublicAnswers(shareToken),
				},
			])}
		>
			<PublicAnswers />
		</HydrationBoundary>
	);
}
