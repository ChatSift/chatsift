'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ModmailPanel } from '@/api/routes/modmail';
import { useDeleteModmailPanel } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';

interface PanelCardProps {
	readonly channelName: string | undefined;
	readonly guildId: string;
	readonly panel: ModmailPanel;
}

export function PanelCard({ guildId, panel, channelName }: PanelCardProps) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deletePanel = useDeleteModmailPanel(guildId);

	const channelLabel = `#${channelName ?? panel.channelId}`;

	return (
		<div className="flex h-36 w-full flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
				{channelLabel}
			</p>
			<p className="text-sm text-secondary dark:text-secondary-dark">
				{panel.categoryIds.length} {panel.categoryIds.length === 1 ? 'category' : 'categories'}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/modmail/panels/${panel.id}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Delete</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Delete panel"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deletePanel.mutateAsync(panel.id)}
				onOpenChange={setIsConfirmOpen}
				title={`Delete the panel in ${channelLabel}?`}
			>
				Its message is removed from {channelLabel}, so nobody can open a thread from there anymore
				{panel.categoryIds.length > 0 &&
					` (it currently offers ${panel.categoryIds.length} categor${panel.categoryIds.length === 1 ? 'y' : 'ies'})`}
				. The categories themselves and any threads already opened through this panel are left alone.
			</ConfirmModal>
		</div>
	);
}
