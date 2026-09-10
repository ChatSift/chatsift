import type { GuildSummary } from '@chatsift/api';
import { GenericAvatar } from '@chatsift/web-core/components/GenericAvatar';

interface GuildBadgeProps {
	readonly guild: GuildSummary | null;
	/**
	 * What to call a server the Appeals bot can no longer see -- it still has to render, since the appeal it
	 * belongs to is the appellant's own record.
	 */
	readonly unknownLabel?: string;
}

export function GuildBadge({ guild, unknownLabel = 'Unknown server' }: GuildBadgeProps) {
	const name = guild?.name ?? unknownLabel;

	return (
		<div className="flex items-center gap-3">
			<GenericAvatar
				assetURL={guild?.iconUrl ?? undefined}
				className="h-10 w-10"
				disableLink
				initials={name.slice(0, 2).toUpperCase()}
				isLoading={false}
			/>
			<span className="text-lg font-medium text-primary dark:text-primary-dark">{name}</span>
		</div>
	);
}
