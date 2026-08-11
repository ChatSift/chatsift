import { getPublicAnswersOrNull } from './_lib/publicAnswers';
import { renderOgCard } from '@/utils/og';
import { SITE_DESCRIPTION, SITE_NAME } from '@/utils/site';

export { OG_CONTENT_TYPE as contentType, OG_SIZE as size } from '@/utils/site';

export const alt = `An AMA on ${SITE_NAME}`;

export default async function Image({ params }: { readonly params: Promise<{ shareToken: string }> }) {
	const { shareToken } = await params;
	// Shares the `cache()`d fetch with `generateMetadata`, so an unfurl costs one API call, not two.
	const data = await getPublicAnswersOrNull(shareToken);

	if (!data) {
		return renderOgCard({ title: SITE_NAME, subtitle: SITE_DESCRIPTION });
	}

	const answered = data.questions.length;
	return renderOgCard({
		eyebrow: 'AMA',
		title: data.title,
		subtitle:
			answered === 0 ? 'No questions answered yet' : `${answered} answered question${answered === 1 ? '' : 's'}`,
	});
}
