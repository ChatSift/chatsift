import type { APIUser, Snowflake } from '@discordjs/core';
import { snapshotUserLabel } from './userDisplay';
import { DiscordUserAvatar } from '@/components/common/DiscordUserAvatar';
import { cn } from '@/utils/util';

interface UserBadgeProps {
	/**
	 * The account's id. Also the fallback subject when `user` is `null` -- Discord 404s an account that has been
	 * deleted, and its id is still enough for the default avatar.
	 */
	readonly id: Snowflake;
	readonly size?: 'lg' | 'sm';
	readonly storedTag: string | null;
	readonly user: APIUser | Snowflake | null;
}

/**
 * An account as a case, report or reporter refers to it: avatar, the name we can produce for it, and the id
 * underneath (#372, #382).
 *
 * The id stays visible rather than being folded into a tooltip -- a case's subject has usually left by the time
 * anyone reads it back, which makes the id the only handle that still works for a ban appeal or a cross-check.
 * The label prefers the guild's own stored snapshot over the live account, so a case reads as the person the
 * moderator acted on rather than whoever holds that name now.
 */
export function UserBadge({ user, storedTag, id, size = 'sm' }: UserBadgeProps) {
	const label = snapshotUserLabel(user ?? id, storedTag);

	return (
		<div className="flex min-w-0 items-center gap-2">
			<DiscordUserAvatar
				className={cn('shrink-0 rounded-full', size === 'lg' ? 'h-10 w-10' : 'h-6 w-6')}
				initials={label.slice(0, 2)}
				user={user ?? id}
			/>
			<div className="flex min-w-0 flex-col">
				<span className={cn('truncate text-primary dark:text-primary-dark', size === 'lg' && 'text-lg')}>{label}</span>
				<span className="truncate text-xs text-secondary dark:text-secondary-dark">{id}</span>
			</div>
		</div>
	);
}
