'use client';

import { useParams } from 'next/navigation';
import { DashboardCrumbs } from './DashboardCrumbs';
import { useGuildInfo } from '@/api/routes/guilds';

/**
 * Resolves the `social/channels/[channelId]`, `social/roles/[roleId]` and `social/rewards/[roleId]` breadcrumb
 * segments. One component for all three because they resolve against the same fetch -- these tables key on the
 * snowflake, so the name has to come from Discord rather than from the row (unlike `ModmailCategoryCrumbs` and
 * friends, which read a stored `name`).
 */
export function SocialGuildCrumbs() {
	const { id: guildId } = useParams<{ id: string }>();

	const { data: guildInfo } = useGuildInfo(guildId, 'SOCIAL');

	return (
		<DashboardCrumbs segmentOptionsData={{ socialChannels: guildInfo?.channels, socialRoles: guildInfo?.roles }} />
	);
}
