'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import { useState } from 'react';
import type { Grant } from '@/api/routes/guilds';
import { useDeleteGrant } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { UserAvatar } from '@/components/user/UserAvatar';
import { formatDate } from '@/utils/util';

interface GrantCardProps {
	readonly grant: Grant;
	readonly guildId: string;
}

function userDisplayName(user: APIUser | Snowflake): string {
	if (typeof user === 'string') {
		return user;
	}

	return user.global_name ?? `${user.username}${user.discriminator === '0' ? '' : `#${user.discriminator}`}`;
}

export function GrantCard({ guildId, grant }: GrantCardProps) {
	const { user, createdBy, createdAt } = grant;
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteGrant = useDeleteGrant(guildId);

	const isUserObject = typeof user !== 'string';
	const userId = typeof user === 'string' ? user : user.id;
	const username = isUserObject
		? `${user.username}${user.discriminator === '0' ? '' : `#${user.discriminator}`}`
		: userId;
	const globalName = isUserObject && user.global_name ? user.global_name : undefined;

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex items-center gap-3">
				{isUserObject ? (
					<UserAvatar className="h-12 w-12 rounded-full" isLoading={false} user={user} />
				) : (
					<div className="h-12 w-12 shrink-0 rounded-full bg-on-tertiary dark:bg-on-tertiary-dark" />
				)}
				<div className="flex flex-col overflow-hidden">
					{globalName && (
						<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
							{globalName}
						</p>
					)}
					<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-sm text-secondary dark:text-secondary-dark">
						{username}
					</p>
				</div>
			</div>

			<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-xs text-secondary dark:text-secondary-dark">
				Granted by {userDisplayName(createdBy)} on {formatDate(new Date(createdAt))}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Remove</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Remove access"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteGrant.mutateAsync({ userId })}
				onOpenChange={setIsConfirmOpen}
				title={`Remove ${globalName ?? username}'s access?`}
			>
				They lose access to this server&apos;s dashboard immediately. You can grant it again later, but this record of
				who granted it and when is gone for good.
			</ConfirmModal>
		</div>
	);
}
