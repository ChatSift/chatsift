'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AutomoderatorReportPrompt } from '@/api/routes/automoderatorReports';
import { useDeleteAutomoderatorReportPrompt } from '@/api/routes/automoderatorReports';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';

interface ReportPromptCardProps {
	readonly channelName: string | undefined;
	readonly guildId: string;
	readonly prompt: AutomoderatorReportPrompt;
}

export function ReportPromptCard({ guildId, prompt, channelName }: ReportPromptCardProps) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const [linkCopied, setLinkCopied] = useState(false);
	const deletePrompt = useDeleteAutomoderatorReportPrompt(guildId);

	const channelLabel = `#${channelName ?? prompt.channelId}`;

	return (
		<div className="flex h-36 w-full flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="truncate text-lg font-medium text-primary dark:text-primary-dark">{channelLabel}</p>
			<div className="flex items-center gap-2">
				{/* Copied rather than linked: a discord.com/channels link opens the *browser* client, which is not
				    where anyone managing a server is working. */}
				<Button
					className="h-fit p-0 text-sm text-misc-accent underline hover:bg-transparent"
					onPress={async () => {
						await navigator.clipboard.writeText(
							`https://discord.com/channels/${guildId}/${prompt.channelId}/${prompt.messageId}`,
						);
						setLinkCopied(true);
						setTimeout(() => setLinkCopied(false), 2_000);
					}}
				>
					Copy message link
				</Button>
				{linkCopied && <span className="text-sm text-misc-accent">Copied!</span>}
			</div>

			<div className="mt-auto flex justify-end gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/automoderator/report-prompts/${prompt.id}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Delete</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Delete prompt"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deletePrompt.mutateAsync(prompt.id)}
				onOpenChange={setIsConfirmOpen}
				title={`Delete the prompt in ${channelLabel}?`}
			>
				Its message is removed from {channelLabel}, so members lose that route to the install link. Anyone who has
				already installed the app keeps it, and reports already filed are untouched.
			</ConfirmModal>
		</div>
	);
}
