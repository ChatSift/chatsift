'use client';

import type { APIUser, Snowflake } from '@discordjs/core';
import { Button } from '@/components/common/Button';
import { UserAvatar } from '@/components/user/UserAvatar';
import { client } from '@/data/client';

interface GrantCardProps {
	readonly guildId: string;
	readonly isLoading: boolean;
	readonly user: APIUser | Snowflake;
}

export function GrantCard({ guildId, user, isLoading }: GrantCardProps) {
	const deleteGrant = client.guilds.grants.useDeleteGrant(guildId);

	const handleRemove = async () => {
		const userId = typeof user === 'string' ? user : user.id;
		await deleteGrant.mutateAsync({ userId });
	};

	const isUserObject = typeof user !== 'string';
	const userId = typeof user === 'string' ? user : user.id;
	const username = isUserObject
		? `${user.username}${user.discriminator === '0' ? '' : `#${user.discriminator}`}`
		: userId;
	const globalName = isUserObject && user.global_name ? user.global_name : undefined;

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex items-center gap-3">
				{(isLoading || user) && (
					<UserAvatar className="h-12 w-12 rounded-full" isLoading={false} user={isUserObject ? user : undefined} />
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
			<div className="mt-auto flex justify-end">
				<Button onPress={handleRemove}>
					<span className="text-red-500">Remove</span>
				</Button>
			</div>
		</div>
	);
}
