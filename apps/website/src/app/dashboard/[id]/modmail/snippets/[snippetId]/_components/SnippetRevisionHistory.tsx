'use client';

import { useParams } from 'next/navigation';
import { FaHistory } from 'react-icons/fa';
import type { ModmailSnippetRevision } from '@/api/routes/modmail';
import { useModmailSnippetRevisions } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { formatDate } from '@/utils/util';

const CHANGED_FIELD_LABELS: Record<ModmailSnippetRevision['changed'][number], string> = {
	attachmentFilename: 'attachment filename',
	attachmentUrl: 'attachment',
	content: 'content',
	name: 'name',
};

/**
 * Same fallback chain the config screen's audit line uses (`enabledByLabel` in `ModmailConfigForm.tsx`) --
 * the API hands back a resolved `APIUser` where Discord still knows the id, and the bare snowflake where it
 * doesn't (deleted account, or a lookup that failed).
 */
function editorLabel(updatedBy: ModmailSnippetRevision['updatedBy']): string {
	return typeof updatedBy === 'string' ? updatedBy : (updatedBy.global_name ?? updatedBy.username);
}

function RevisionCard({
	onRestore,
	revision,
}: {
	onRestore(revision: ModmailSnippetRevision): void;
	readonly revision: ModmailSnippetRevision;
}) {
	// A row written before #324 only ever captured the content, so there's no name or attachment to show
	// or put back -- see `getSnippetUpdates.ts` on why `oldName === null` is the marker for that.
	const isLegacy = revision.oldName === null;

	return (
		<div className="flex flex-col gap-2 rounded border border-on-secondary p-3 dark:border-on-secondary-dark">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<p className="text-xs text-secondary dark:text-secondary-dark">
					{editorLabel(revision.updatedBy)} -- {formatDate(new Date(revision.updatedAt))}
				</p>
				{revision.changed.map((field) => (
					<span className="rounded-full bg-misc-accent/10 px-2 py-0.5 text-xs text-misc-accent" key={field}>
						{CHANGED_FIELD_LABELS[field]}
					</span>
				))}
			</div>

			{revision.oldName !== null && (
				<p className="font-mono text-sm font-semibold text-primary dark:text-primary-dark">/{revision.oldName}</p>
			)}

			<p className="whitespace-pre-wrap text-sm text-primary dark:text-primary-dark">{revision.oldContent}</p>

			{revision.oldAttachmentUrl && (
				// Plain link, never an inline preview -- `SnippetCard.tsx` gates even the *current* attachment's
				// `<img>` behind an explicit click so a staff-pasted URL isn't fetched unprompted, and that
				// applies at least as strongly to a URL that isn't even in use anymore.
				<a
					className="text-sm text-misc-accent underline"
					href={revision.oldAttachmentUrl}
					rel="noreferrer"
					target="_blank"
				>
					{revision.oldAttachmentFilename ?? revision.oldAttachmentUrl}
				</a>
			)}

			<div className="flex items-center gap-2">
				<Button className="h-fit px-2 py-1 text-sm" onPress={() => onRestore(revision)}>
					{isLegacy ? 'Restore content' : 'Restore this version'}
				</Button>
				{isLegacy && (
					<p className="text-xs text-secondary dark:text-secondary-dark">
						Recorded before name and attachment history was kept.
					</p>
				)}
			</div>
		</div>
	);
}

interface SnippetRevisionHistoryProps {
	onRestore(revision: ModmailSnippetRevision): void;
	readonly snippetId: number;
}

/**
 * The snippet edit page's revision history panel (#324). `snippet_updates` had been written on every edit
 * since M5 without anything ever reading it back.
 *
 * Rendered inline under the form rather than in a popover the way `EditHistoryBadge.tsx` does the
 * equivalent for thread messages: there's a whole page column to spend here, so a revision can show its
 * full prior content instead of a truncated peek, and "Restore" needs somewhere to put a version once it's
 * chosen -- the form right above it.
 */
export function SnippetRevisionHistory({ onRestore, snippetId }: SnippetRevisionHistoryProps) {
	const { id: guildId } = useParams<{ id: string }>();
	const { data, error, isLoading } = useModmailSnippetRevisions(guildId, snippetId);

	// Same stale-data-wins guard as every other list here (see `BlocksList.tsx`): a failed background
	// refetch shouldn't replace history that's already on screen with an error state.
	if (error && data === undefined) {
		return (
			<section className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Revision History</h2>
				<UserErrorHandler error={error} />
			</section>
		);
	}

	return (
		<section className="space-y-4">
			<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Revision History</h2>

			{isLoading ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-24 w-full" />
				</div>
			) : data!.revisions.length === 0 ? (
				<EmptyState
					icon={<FaHistory className="h-6 w-6 text-secondary dark:text-secondary-dark" />}
					subtitle="Every edit to this snippet will be recorded here."
					title="No edits yet"
				/>
			) : (
				<div className="flex flex-col gap-2">
					{data!.revisions.map((revision) => (
						<RevisionCard key={revision.id} onRestore={onRestore} revision={revision} />
					))}
				</div>
			)}
		</section>
	);
}
