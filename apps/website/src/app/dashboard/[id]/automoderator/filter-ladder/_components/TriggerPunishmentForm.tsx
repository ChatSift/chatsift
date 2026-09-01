'use client';

import { TRIGGER_PUNISHMENT_MAX_COUNT, TRIGGER_PUNISHMENT_MAX_TRIGGERS } from '@chatsift/core';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
	ACTION_LABELS,
	DURATION_RULE,
	formatDurationInput,
	parseDurationInput,
	TRIGGER_PUNISHMENT_ACTIONS,
} from './triggerLadderDisplay';
import { mapApiErrorToFieldErrors } from '@/api/formErrors';
import type {
	AutomoderatorTriggerPunishment,
	TriggerPunishmentActionName,
} from '@/api/routes/automoderatorTriggerPunishments';
import {
	useAutomoderatorTriggerPunishments,
	useSetAutomoderatorTriggerPunishment,
} from '@/api/routes/automoderatorTriggerPunishments';
import { Button } from '@/components/common/Button';
import { FormActions } from '@/components/common/FormActions';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { cn } from '@/utils/util';

interface StepFormData {
	actionType: TriggerPunishmentActionName;
	duration: string;
	triggers: string;
}

type StepFormErrors = Partial<Record<keyof StepFormData, string>>;

const STEP_FIELDS = ['triggers', 'actionType', 'duration'] as const satisfies (keyof StepFormData)[];

const DURATION_HELP: Record<TriggerPunishmentActionName, string> = {
	WARN: 'Cannot set duration for warnings.',
	MUTE: 'How long the timeout lasts, e.g. "30m", "2h", "7d". Discord timeouts cap out at 28 days.',
	KICK: 'Cannot set duration for kicks.',
	BAN: 'How long the ban lasts, e.g. "7d", "3mo". Leave empty to ban permanently.',
};

interface TriggerPunishmentFormProps {
	/**
	 * The step being edited, or `undefined` when adding one. Identified by its trigger count (the table's
	 * primary key), so re-submitting an existing count edits that step; renumbering sends the old count as
	 * `replaces`, which the API applies as one atomic move.
	 */
	readonly step?: AutomoderatorTriggerPunishment | undefined;
}

export function TriggerPunishmentForm({ step }: TriggerPunishmentFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<StepFormData>(() => ({
		triggers: String(step?.triggers ?? 3),
		actionType: (step?.actionType as TriggerPunishmentActionName | undefined) ?? 'WARN',
		duration: formatDurationInput(step?.durationSeconds ?? null),
	}));
	const [errors, setErrors] = useState<StepFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: steps, error: stepsError } = useAutomoderatorTriggerPunishments(guildId);
	const setStep = useSetAutomoderatorTriggerPunishment(guildId);

	const updateField = <TField extends keyof StepFormData>(field: TField, value: StepFormData[TField]) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
		setSuccessMessage(null);
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		const triggers = Number(form.triggers.trim());
		if (!Number.isInteger(triggers) || triggers < 1 || triggers > TRIGGER_PUNISHMENT_MAX_TRIGGERS) {
			setErrors({ triggers: `Pick a whole number between 1 and ${TRIGGER_PUNISHMENT_MAX_TRIGGERS}.` });
			return;
		}

		// The list has to have loaded before a count can be claimed, or this would silently overwrite a step
		// somebody else already configured at that number.
		if (steps === undefined) {
			setErrors({
				triggers: stepsError
					? "Couldn't load this server's existing steps, so picking a number isn't safe right now. Reload and try again."
					: "Still loading this server's existing steps.",
			});
			return;
		}

		if (triggers !== step?.triggers && steps.some((candidate) => candidate.triggers === triggers)) {
			setErrors({ triggers: 'There is already a step at that number of triggers.' });
			return;
		}

		const parsed = parseDurationInput(form.duration, form.actionType);
		if (!parsed.ok) {
			setErrors({ duration: parsed.message });
			return;
		}

		setSuccessMessage(null);

		const isRenumber = Boolean(step) && triggers !== step?.triggers;

		try {
			await setStep.mutateAsync({
				triggers,
				actionType: form.actionType,
				durationSeconds: parsed.seconds,
				...(isRenumber ? { replaces: Number(step!.triggers) } : {}),
			});

			if (isRenumber) {
				router.replace(`/dashboard/${guildId}/automoderator/filter-ladder`);
				return;
			}

			if (step) {
				setErrors({});
				setSuccessMessage('Step updated.');
				return;
			}

			router.replace(`/dashboard/${guildId}/automoderator/filter-ladder`);
		} catch (error) {
			setErrors(
				mapApiErrorToFieldErrors(error, {
					fields: STEP_FIELDS,
					fallbackField: 'triggers',
					entityName: 'step',
					failureVerb: step ? 'update' : 'add',
				}),
			);
		}
	};

	const atLimit = !step && (steps?.length ?? 0) >= TRIGGER_PUNISHMENT_MAX_COUNT;

	return (
		<form className="mt-8 max-w-2xl space-y-6" onSubmit={handleSubmit}>
			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent"
					role="status"
				>
					{successMessage}
				</p>
			)}

			{atLimit && (
				<p className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger" role="alert">
					This server already has {TRIGGER_PUNISHMENT_MAX_COUNT} steps. Remove one before adding another.
				</p>
			)}

			<div className="space-y-4">
				<TextField
					error={errors.triggers}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Fires when a member reaches <em>exactly</em> this many filter triggers. A message caught by two filters at
							once still counts as one, and banned-word hits are never counted — those carry their own punishment.
						</p>
					}
					id="trigger-step-triggers"
					label="Triggers"
					max={TRIGGER_PUNISHMENT_MAX_TRIGGERS}
					min={1}
					onChange={(value) => updateField('triggers', value)}
					type="number"
					value={form.triggers}
				/>

				<div>
					<span
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						id="trigger-step-action"
					>
						Punishment
					</span>
					<div
						aria-labelledby="trigger-step-action"
						className="inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
						role="group"
					>
						{TRIGGER_PUNISHMENT_ACTIONS.map((action) => (
							<Button
								aria-pressed={form.actionType === action}
								className={cn(
									'rounded px-4 py-1.5 text-sm font-medium transition-colors',
									form.actionType === action
										? 'bg-misc-accent text-accent shadow-sm'
										: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
								)}
								key={action}
								onPress={() => updateField('actionType', action)}
								type="button"
							>
								{ACTION_LABELS[action]}
							</Button>
						))}
					</div>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						A warning here counts toward the warn ladder too, so it can escalate further on its own.
					</p>
				</div>

				<TextField
					disabled={DURATION_RULE[form.actionType] === 'forbidden'}
					error={errors.duration}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">{DURATION_HELP[form.actionType]}</p>
					}
					id="trigger-step-duration"
					label="Duration"
					onChange={(value) => updateField('duration', value)}
					placeholder={DURATION_RULE[form.actionType] === 'required' ? '1h' : '7d'}
					value={DURATION_RULE[form.actionType] === 'forbidden' ? '' : form.duration}
				/>
			</div>

			<FormActions
				isSubmitDisabled={atLimit || steps === undefined}
				isSubmitting={setStep.isPending}
				onCancel={() => router.back()}
				pendingLabel={step ? 'Saving...' : 'Adding...'}
				submitLabel={step ? 'Save Changes' : 'Add Step'}
			/>
		</form>
	);
}

export function EditTriggerPunishmentFormLoader() {
	const params = useParams<{ id: string; triggers: string }>();
	const { data: steps, isLoading, error } = useAutomoderatorTriggerPunishments(params.id);

	if (error && steps === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !steps) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	const step = steps.find((candidate) => String(candidate.triggers) === params.triggers);
	if (!step) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Step not found</p>
			</div>
		);
	}

	return <TriggerPunishmentForm step={step} />;
}
