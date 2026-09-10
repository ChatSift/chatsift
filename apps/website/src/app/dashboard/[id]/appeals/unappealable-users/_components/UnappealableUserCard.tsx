'use client';

import { Button } from '@chatsift/web-core/components/Button';
import { ConfirmModal } from '@chatsift/web-core/components/ConfirmModal';
import { DiscordUserAvatar } from '@chatsift/web-core/components/DiscordUserAvatar';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import type { APIUser, Snowflake } from 'discord-api-types/v10';
import { useState } from 'react';
import type { UnappealableUser } from '@/api/routes/appeals';
import { useDeleteUnappealableUser } from '@/api/routes/appeals';
import { formatDate } from '@/utils/util';

interface UnappealableUserCardProps {
	readonly entry: UnappealableUser;
	readonly guildId: string;
}

/**
 * `resolveDiscordUser` hands back the bare id when Discord 404s the account, which is common here -- the
 * subject of an old ban has usually deleted their account or is long gone.
 */
function userLabel(user: APIUser | Snowflake): string {
	return typeof user === 'string' ? user : (user.global_name ?? user.username);
}

export function UnappealableUserCard({ entry, guildId }: UnappealableUserCardProps) {
	const { user, createdBy, reason, createdAt } = entry;
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteUnappealable = useDeleteUnappealableUser(guildId);

	const userId = typeof user === 'string' ? user : user.id;
	const label = userLabel(user);
	// A deleted account has nothing to be called but its id, so without this the same snowflake renders twice,
	// stacked -- the same case `UserBadge` guards (#372).
	const hasName = label !== userId;

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex items-center gap-3">
				<DiscordUserAvatar className="h-12 w-12 shrink-0 rounded-full" initials={label.slice(0, 2)} user={user} />
				<div className="flex min-w-0 flex-col">
					<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">{label}</p>
					{hasName && <p className="truncate text-sm text-secondary dark:text-secondary-dark">{userId}</p>}
				</div>
			</div>

			{reason ? (
				<p className="text-sm break-words text-primary dark:text-primary-dark">{reason}</p>
			) : (
				<p className="text-sm text-secondary italic dark:text-secondary-dark">No reason given</p>
			)}

			<p className="text-xs text-secondary dark:text-secondary-dark">
				Added by {userLabel(createdBy)} on {formatDate(new Date(createdAt))}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				<Button className={buttonClass('danger', 'sm')} onPress={() => setIsConfirmOpen(true)}>
					Remove
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Remove"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteUnappealable.mutateAsync(userId)}
				onOpenChange={setIsConfirmOpen}
				title={`Let ${label} appeal again?`}
			>
				They&apos;ll be able to file an appeal from their next attempt, subject to the usual cooldown. This does not
				unban them.
			</ConfirmModal>
		</div>
	);
}
