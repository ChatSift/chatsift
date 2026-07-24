'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ModmailPanel } from '@/api/routes/modmail';
import { useDeleteModmailPanel } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';

interface PanelCardProps {
	readonly channelName: string | undefined;
	readonly guildId: string;
	readonly panel: ModmailPanel;
}

export function PanelCard({ guildId, panel, channelName }: PanelCardProps) {
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
	const deletePanel = useDeleteModmailPanel(guildId);

	const handleDelete = async () => {
		await deletePanel.mutateAsync(panel.id);
		setShowConfirmDelete(false);
	};

	return (
		<div className="flex h-36 w-full flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
				#{channelName ?? panel.channelId}
			</p>
			<p className="text-sm text-secondary dark:text-secondary-dark">
				{panel.categoryIds.length} {panel.categoryIds.length === 1 ? 'category' : 'categories'}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				{showConfirmDelete ? (
					<>
						<Button onPress={handleDelete}>
							<span className="text-red-500">Yes, delete</span>
						</Button>
						<Button onPress={() => setShowConfirmDelete(false)}>Cancel</Button>
					</>
				) : (
					<>
						<Link
							className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
							href={`/dashboard/${guildId}/modmail/panels/${panel.id}`}
						>
							Edit
						</Link>
						<Button onPress={() => setShowConfirmDelete(true)}>
							<span className="text-red-500">Delete</span>
						</Button>
					</>
				)}
			</div>
		</div>
	);
}
