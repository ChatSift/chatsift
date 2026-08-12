'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from './DashboardCrumbs';
import { useSocialInteractions } from '@/api/routes/social';

/**
 * Resolves the `social/interactions/[interactionId]` breadcrumb segment to the interaction's command name --
 * mirrors `ModmailSnippetCrumbs`.
 */
export function SocialInteractionCrumbs() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: interactions } = useSocialInteractions(guildId);

	return <DashboardCrumbs segmentOptionsData={{ socialInteractions: interactions }} />;
}
