'use client';

import { useState } from 'react';
import type { ModmailBlock } from '@/api/routes/modmail';
import { useDeleteModmailBlock } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { UserAvatar } from '@/components/user/UserAvatar';
import { formatDate } from '@/utils/util';

interface BlockCardProps {
	readonly block: ModmailBlock;
	readonly guildId: string;
}

export function BlockCard({ guildId, block }: BlockCardProps) {
	const { user, expiresAt } = block;
	const [showConfirm, setShowConfirm] = useState(false);
	const deleteBlock = useDeleteModmailBlock(guildId);

	const isUserObject = typeof user !== 'string';
	const userId = isUserObject ? user.id : user;
	const username = isUserObject ? `${user.username}${user.discriminator === '0' ? '' : `#${user.discriminator}`}` : userId;
	const globalName = isUserObject && user.global_name ? user.global_name : undefined;

	const handleRemove = async () => {
		await deleteBlock.mutateAsync(userId);
		setShowConfirm(false);
	};

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

			<p className="text-xs text-secondary dark:text-secondary-dark">
				{expiresAt ? `Expires ${formatDate(new Date(expiresAt))}` : 'Never expires'}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				{showConfirm ? (
					<>
						<Button onPress={handleRemove}>
							<span className="text-red-500">Yes, unblock</span>
						</Button>
						<Button onPress={() => setShowConfirm(false)}>Cancel</Button>
					</>
				) : (
					<Button onPress={() => setShowConfirm(true)}>
						<span className="text-red-500">Unblock</span>
					</Button>
				)}
			</div>
		</div>
	);
}
