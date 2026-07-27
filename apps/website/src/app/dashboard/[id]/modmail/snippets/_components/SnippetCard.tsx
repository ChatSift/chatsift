'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useGrantAuth } from '@/api/grant';
import type { ModmailSnippet } from '@/api/routes/modmail';
import { useDeleteModmailSnippet } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { formatDate } from '@/utils/util';

function isImageAttachment(snippet: Pick<ModmailSnippet, 'attachmentFilename' | 'attachmentUrl'>): boolean {
	const name = snippet.attachmentFilename ?? snippet.attachmentUrl ?? '';
	return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(name);
}

interface SnippetCardProps {
	readonly guildId: string;
	readonly snippet: ModmailSnippet;
}

export function SnippetCard({ guildId, snippet }: SnippetCardProps) {
	const grant = useGrantAuth();
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

			<p className="whitespace-pre-wrap text-sm text-primary dark:text-primary-dark">{snippet.content}</p>

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

			{/* A `/snippet create` grant only ever authorizes creating one snippet, not editing/deleting existing
			ones -- those routes don't accept the grant server-side either, so hiding these controls here is
			belt-and-suspenders, not the only guard. The list itself stays visible under a grant. */}
			{!grant && (
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
			)}
		</div>
	);
}
