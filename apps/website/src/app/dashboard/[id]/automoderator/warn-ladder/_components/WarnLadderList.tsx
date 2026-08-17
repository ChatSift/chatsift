'use client';

import { automoderatorWarnPunishmentsChannel, WARN_PUNISHMENT_MAX_COUNT } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { describeStep } from './ladderDisplay';
import { queryKeys } from '@/api/queryClient';
import type { AutomoderatorWarnPunishment, WarnPunishmentActionName } from '@/api/routes/automoderatorWarnPunishments';
import {
	useAutomoderatorWarnPunishments,
	useDeleteAutomoderatorWarnPunishment,
} from '@/api/routes/automoderatorWarnPunishments';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgPlus } from '@/components/icons/SvgPlus';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

function WarnStepCard({ guildId, step }: { readonly guildId: string; readonly step: AutomoderatorWarnPunishment }) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deleteStep = useDeleteAutomoderatorWarnPunishment(guildId);
	const label = `${step.warns} ${step.warns === 1 ? 'warning' : 'warnings'}`;

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm font-medium text-secondary dark:text-secondary-dark">At {label}</p>
			<p className="truncate text-lg font-semibold text-primary dark:text-primary-dark">
				{describeStep(step.actionType as WarnPunishmentActionName, step.durationSeconds)}
			</p>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				Fires on the warning that brings them to exactly {step.warns}.
			</p>

			<div className="mt-auto flex justify-end gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-lg text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/automoderator/warn-ladder/${step.warns}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Delete</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Delete step"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => deleteStep.mutateAsync(step.warns)}
				onOpenChange={setIsConfirmOpen}
				title={`Stop acting at ${label}?`}
			>
				Reaching {label} will only record the warning. Cases this step already produced stay exactly as they are.
			</ConfirmModal>
		</div>
	);
}

function AddStepCard({ disabled, guildId }: { readonly disabled: boolean; readonly guildId: string }) {
	if (disabled) {
		return (
			<div className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 self-stretch rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 text-center opacity-50 dark:border-on-secondary-dark dark:bg-card-dark">
				<span className="text-sm text-secondary dark:text-secondary-dark">
					You already have {WARN_PUNISHMENT_MAX_COUNT} steps.
				</span>
			</div>
		);
	}

	return (
		<Link
			className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 self-stretch rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark"
			href={`/dashboard/${guildId}/automoderator/warn-ladder/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Add Step</span>
		</Link>
	);
}

export function WarnLadderList() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorWarnPunishmentsChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.warnPunishments(guildId) });
	});

	const { data: steps, isLoading, error } = useAutomoderatorWarnPunishments(guildId);

	if (error && steps === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !steps) {
		return (
			<>
				<AddStepCard disabled={false} guildId={guildId} />
				<Skeleton className="h-36 w-full rounded-lg" />
				<Skeleton className="h-36 w-full rounded-lg" />
			</>
		);
	}

	return (
		<>
			<AddStepCard disabled={steps.length >= WARN_PUNISHMENT_MAX_COUNT} guildId={guildId} />
			{/* Already ordered by warn count server-side -- escalation order is the only meaningful one here. */}
			{steps.map((step) => (
				<WarnStepCard guildId={guildId} key={step.warns} step={step} />
			))}
		</>
	);
}
