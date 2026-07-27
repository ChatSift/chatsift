'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from './DashboardCrumbs';
import { useModmailSnippets } from '@/api/routes/modmail';

/**
 * Resolves the `modmail/snippets/[snippetId]` breadcrumb segment to the snippet's name -- mirrors
 * `ModmailPanelCrumbs`'s equivalent for `modmail/panels/[panelId]`.
 */
export function ModmailSnippetCrumbs() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: snippets } = useModmailSnippets(guildId);

	return <DashboardCrumbs segmentOptionsData={{ modmailSnippets: snippets }} />;
}
