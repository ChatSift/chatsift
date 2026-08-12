'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { SocialInteraction } from '@/api/routes/social';
import { useDeleteSocialInteraction, useSocialInteractions } from '@/api/routes/social';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgPlus } from '@/components/icons/SvgPlus';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface SocialInteractionCardProps {
	readonly guildId: string;
	readonly interaction: SocialInteraction;
}

function SocialInteractionCard({ guildId, interaction }: SocialInteractionCardProps) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteInteraction = useDeleteSocialInteraction(guildId);

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex items-start justify-between gap-2">
				<p className="overflow-hidden overflow-ellipsis whitespace-nowrap font-mono text-lg font-semibold text-primary dark:text-primary-dark">
					/{interaction.name}
				</p>
				{/* A null command id means no live Discord command backs this row -- the state every migrated
				    interaction starts in. Dispatch still resolves it by name and heals the id on first use, so this
				    is a nudge towards the resync card above rather than an error. */}
				{interaction.commandId === null && (
					<span className="shrink-0 rounded-md border border-misc-warning/40 bg-misc-warning/10 px-1.5 py-0.5 text-xs text-misc-warning dark:border-misc-warning-dark/40 dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark">
						Needs resync
					</span>
				)}
			</div>

			<p className="line-clamp-3 whitespace-pre-wrap text-sm text-primary dark:text-primary-dark">
				{interaction.content}
			</p>

			<p className="text-xs text-secondary dark:text-secondary-dark">
				{interaction.embed ? 'Embed' : 'Plain message'}
				{interaction.allowTargets ? ' -- can target people' : ''} --{' '}
				{interaction.uses === 0 ? 'never used' : `used ${interaction.uses} time${interaction.uses === 1 ? '' : 's'}`}
			</p>

			<div className="mt-auto flex justify-end gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/social/interactions/${interaction.id}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Delete</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Delete interaction"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteInteraction.mutateAsync(interaction.id)}
				onOpenChange={setIsConfirmOpen}
				title={`Delete /${interaction.name}?`}
			>
				The /{interaction.name} command is removed from this server, so nobody can use it anymore.
				{interaction.uses > 0 &&
					` It's been used ${interaction.uses} time${interaction.uses === 1 ? '' : 's'} so far.`}{' '}
				This can&apos;t be undone.
			</ConfirmModal>
		</div>
	);
}

function AddInteractionCard({ guildId }: { readonly guildId: string }) {
	return (
		<Link
			className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 self-stretch rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark"
			href={`/dashboard/${guildId}/social/interactions/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Add Interaction</span>
		</Link>
	);
}

export function SocialInteractionsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const { data: interactions, isLoading, error } = useSocialInteractions(guildId);

	if (error && interactions === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<>
				<AddInteractionCard guildId={guildId} />
				<Skeleton className="h-48 w-full rounded-lg" />
				<Skeleton className="h-48 w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			<AddInteractionCard guildId={guildId} />
			{interactions!.map((interaction) => (
				<SocialInteractionCard guildId={guildId} interaction={interaction} key={interaction.id} />
			))}
		</>
	);
}
