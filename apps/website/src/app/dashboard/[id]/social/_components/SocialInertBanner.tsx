'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FaExclamationTriangle } from 'react-icons/fa';
import { isTrackingConfigured } from './socialConfig';
import { useSocialConfig } from '@/api/routes/social';

/**
 * Everything else in this section (channel multipliers, role multipliers, rewards) is dead weight while the
 * guild is inert, and nothing about the individual pages would show that -- they'd just look like configuration
 * that works. Rendered nowhere while the config is still loading, so it can't flash on a configured guild.
 */
export function SocialInertBanner() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: config } = useSocialConfig(guildId);

	if (!config || isTrackingConfigured(config)) {
		return null;
	}

	return (
		<div
			className="flex items-start gap-2 rounded-lg border border-misc-warning/40 bg-misc-warning/10 p-3 text-sm text-misc-warning dark:border-misc-warning-dark/40 dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark"
			role="status"
		>
			<FaExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0" />
			<span>
				Nobody is earning XP in this server yet -- Social stays inert until messages, time window and XP gain are all
				set.{' '}
				<Link className="underline" href={`/dashboard/${guildId}/social/config`}>
					Turn on XP tracking
				</Link>{' '}
				to get started.
			</span>
		</div>
	);
}
