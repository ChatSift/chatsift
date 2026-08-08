'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import type { ModmailSnippet } from '@/api/routes/modmail';
import { useDeleteModmailSnippet } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { formatDate } from '@/utils/util';

// `ssr: false` is load-bearing -- see `DiscordMarkdown.tsx`'s own doc comment on why its wasm parser can't
// be evaluated server-side at all under Next's bundler.
const DiscordMarkdown = dynamic(
	async () => {
		const mod = await import('@/components/common/DiscordMarkdown');
		return mod.DiscordMarkdown;
	},
	{
		loading: () => <Skeleton className="h-4 w-48" />,
		ssr: false,
	},
);

function isImageAttachment(snippet: Pick<ModmailSnippet, 'attachmentFilename' | 'attachmentUrl'>): boolean {
	const name = snippet.attachmentFilename ?? snippet.attachmentUrl ?? '';
	return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(name);
}

interface SnippetCardProps {
	readonly guildId: string;
	readonly snippet: ModmailSnippet;
}

export function SnippetCard({ guildId, snippet }: SnippetCardProps) {
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
	// Rendering an `<img>` fetches it immediately on page load -- for a staff-pasted URL we haven't
	// vetted, that's an unprompted request to wherever they typed, made by every moderator who happens
	// to open this page. Gating it behind an explicit click means the preview only ever loads because
	// someone here chose to load it, same as clicking the link itself. Tracks *which* URL was approved
	// (not just a boolean) so editing the attachment to a different URL always requires a fresh click --
	// otherwise approval granted to the old URL would carry over and silently preview the new one too.
	const [previewedUrl, setPreviewedUrl] = useState<string | null>(null);
	const deleteSnippet = useDeleteModmailSnippet(guildId);

	const handleDelete = async () => {
		await deleteSnippet.mutateAsync(snippet.id);
		setShowConfirmDelete(false);
	};

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="overflow-hidden overflow-ellipsis whitespace-nowrap font-mono text-lg font-semibold text-primary dark:text-primary-dark">
				/{snippet.name}
			</p>

			<div className="whitespace-pre-wrap text-sm text-primary dark:text-primary-dark">
				<DiscordMarkdown content={snippet.content} forBot="MODMAIL" />
			</div>

			{snippet.attachmentUrl && (
				<div className="flex flex-col items-start gap-1">
					<a
						className="text-sm text-misc-accent underline"
						href={snippet.attachmentUrl}
						rel="noreferrer"
						target="_blank"
					>
						{snippet.attachmentFilename ?? snippet.attachmentUrl}
					</a>
					{isImageAttachment(snippet) &&
						(previewedUrl === snippet.attachmentUrl ? (
							// eslint-disable-next-line @next/next/no-img-element -- arbitrary staff-pasted external URL, not one of the app's known image sources Next's optimizer can proxy
							<img
								alt={snippet.attachmentFilename ?? 'snippet attachment'}
								className="max-h-40 rounded-md border border-on-secondary dark:border-on-secondary-dark"
								src={snippet.attachmentUrl}
							/>
						) : (
							<Button
								className="h-fit p-0 text-xs text-secondary underline hover:bg-transparent dark:text-secondary-dark"
								onPress={() => setPreviewedUrl(snippet.attachmentUrl)}
							>
								Show preview
							</Button>
						))}
				</div>
			)}

			<p className="text-xs text-secondary dark:text-secondary-dark">
				{snippet.timesUsed === 0
					? 'Never used'
					: `Used ${snippet.timesUsed} time${snippet.timesUsed === 1 ? '' : 's'}${
							snippet.lastUsedAt ? ` -- last used ${formatDate(new Date(snippet.lastUsedAt))}` : ''
						}`}
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
							href={`/dashboard/${guildId}/modmail/snippets/${snippet.id}`}
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
