'use client';

import { EXPERIMENT_BUCKET_COUNT } from '@chatsift/core';
import { Button } from '@chatsift/web-core/components/Button';
import { ConfirmModal } from '@chatsift/web-core/components/ConfirmModal';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useState } from 'react';
import { ExperimentForm } from './ExperimentForm';
import { rangeSharePercent } from './experimentRange';
import type { Experiment } from '@/api/routes/experiments';
import { useDeleteExperiment } from '@/api/routes/experiments';
import { formatDate } from '@/utils/util';

interface ExperimentCardProps {
	readonly experiment: Experiment;
}

export function ExperimentCard({ experiment }: ExperimentCardProps) {
	const [isEditing, setIsEditing] = useState(false);
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	const deleteExperiment = useDeleteExperiment();

	if (isEditing) {
		return <ExperimentForm existing={experiment} onDone={() => setIsEditing(false)} />;
	}

	const width = ((experiment.rangeEnd - experiment.rangeStart) / EXPERIMENT_BUCKET_COUNT) * 100;
	const offset = (experiment.rangeStart / EXPERIMENT_BUCKET_COUNT) * 100;

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-baseline gap-2">
					<span className="font-mono text-lg font-medium text-primary dark:text-primary-dark">{experiment.name}</span>
					<span className="text-sm text-secondary dark:text-secondary-dark">
						{rangeSharePercent(experiment.rangeStart, experiment.rangeEnd)}
						{experiment.overrides.length > 0 &&
							` · ${experiment.overrides.length} override${experiment.overrides.length === 1 ? '' : 's'}`}
					</span>
				</div>
				<div className="flex gap-2">
					<Button className={buttonClass('secondary', 'sm')} onPress={() => setIsEditing(true)}>
						Edit
					</Button>
					<Button className={buttonClass('danger', 'sm')} onPress={() => setIsConfirmingDelete(true)}>
						Delete
					</Button>
				</div>
			</div>

			{/* The range as a share of the whole bucket space, positioned rather than just sized: two experiments
				at 10% sitting on different offsets select different guilds, and a bar pinned to the left would
				draw those two identically. */}
			<div
				aria-label={`Buckets ${experiment.rangeStart} to ${experiment.rangeEnd}`}
				className="h-2 w-full overflow-hidden rounded-full bg-on-tertiary dark:bg-on-tertiary-dark"
			>
				<div className="h-full rounded-full bg-misc-accent" style={{ marginLeft: `${offset}%`, width: `${width}%` }} />
			</div>

			<div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-secondary dark:text-secondary-dark">
				<span>
					Buckets {experiment.rangeStart.toLocaleString()} - {experiment.rangeEnd.toLocaleString()}
				</span>
				<span>Created {formatDate(new Date(experiment.createdAt))}</span>
				{experiment.updatedAt && <span>Updated {formatDate(new Date(experiment.updatedAt))}</span>}
			</div>

			{experiment.overrides.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{experiment.overrides.map((guildId) => (
						<span
							className="rounded-md bg-on-tertiary px-2 py-0.5 font-mono text-xs text-primary dark:bg-on-tertiary-dark dark:text-primary-dark"
							key={guildId}
						>
							{guildId}
						</span>
					))}
				</div>
			)}

			<ConfirmModal
				confirmLabel="Delete"
				isDestructive
				isOpen={isConfirmingDelete}
				onConfirm={async () => {
					await deleteExperiment.mutateAsync(experiment.name);
					setIsConfirmingDelete(false);
				}}
				onOpenChange={setIsConfirmingDelete}
				title={`Delete ${experiment.name}?`}
			>
				Gated code treats a missing experiment as off, so this switches the feature off everywhere within a minute and
				drops its {experiment.overrides.length} override
				{experiment.overrides.length === 1 ? '' : 's'}. To pause a gate you still want, collapse its range to 0%
				instead.
			</ConfirmModal>
		</div>
	);
}
