'use client';

import { useState } from 'react';
import type { ModmailBlock } from '@/api/routes/modmail';
import { useDeleteModmailBlock } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { UserAvatar } from '@/components/user/UserAvatar';
import { formatDate } from '@/utils/util';

interface BlockCardProps {
	readonly block: ModmailBlock;
	readonly guildId: string;
}

export function BlockCard({ guildId, block }: BlockCardProps) {
	const { user, expiresAt } = block;
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteBlock = useDeleteModmailBlock(guildId);

	const isUserObject = typeof user !== 'string';
	const userId = isUserObject ? user.id : user;
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
						<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">{globalName}</p>
					)}
					<p className="truncate text-sm text-secondary dark:text-secondary-dark">{username}</p>
				</div>
			</div>

			<p className="text-xs text-secondary dark:text-secondary-dark">
				{expiresAt ? `Expires ${formatDate(new Date(expiresAt))}` : 'Never expires'}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Unblock</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Unblock"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteBlock.mutateAsync(userId)}
				onOpenChange={setIsConfirmOpen}
				title={`Unblock ${globalName ?? username}?`}
			>
				They&apos;ll be able to open ModMail threads again straight away.
				{expiresAt && ` The block would otherwise have lapsed on its own ${formatDate(new Date(expiresAt))}.`}
			</ConfirmModal>
		</div>
	);
}
