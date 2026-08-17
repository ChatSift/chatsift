'use client';

import { WARN_PUNISHMENT_MAX_COUNT, WARN_PUNISHMENT_MAX_WARNS } from '@chatsift/core';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
	ACTION_LABELS,
	DURATION_RULE,
	formatDurationInput,
	parseDurationInput,
	WARN_PUNISHMENT_ACTIONS,
} from './ladderDisplay';
import { mapApiErrorToFieldErrors } from '@/api/formErrors';
import type { AutomoderatorWarnPunishment, WarnPunishmentActionName } from '@/api/routes/automoderatorWarnPunishments';
import {
	useAutomoderatorWarnPunishments,
	useDeleteAutomoderatorWarnPunishment,
	useSetAutomoderatorWarnPunishment,
} from '@/api/routes/automoderatorWarnPunishments';
import { Button } from '@/components/common/Button';
import { FormActions } from '@/components/common/FormActions';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { cn } from '@/utils/util';

interface StepFormData {
	actionType: WarnPunishmentActionName;
	duration: string;
	warns: string;
}

type StepFormErrors = Partial<Record<keyof StepFormData, string>>;

const STEP_FIELDS = ['warns', 'actionType', 'duration'] as const satisfies (keyof StepFormData)[];

const DURATION_HELP: Record<WarnPunishmentActionName, string> = {
	MUTE: 'How long the timeout lasts, e.g. "30m", "2h", "7d". Discord timeouts cap out at 28 days.',
	KICK: 'Cannot set duration for kicks.',
	BAN: 'How long the ban lasts, e.g. "7d", "3mo". Leave empty to ban permanently.',
};

interface WarnPunishmentFormProps {
	/**
	 * The step being edited, or `undefined` when adding one. A step is identified by its warn count (the table's
	 * primary key), so re-submitting an existing count moves that step rather than adding a second -- and
	 * renumbering an existing step is a PUT against the new count followed by a DELETE of the old row, the same
	 * shape `SocialRewardForm` uses for retargeting.
	 */
	readonly step?: AutomoderatorWarnPunishment | undefined;
}

export function WarnPunishmentForm({ step }: WarnPunishmentFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<StepFormData>(() => ({
		warns: String(step?.warns ?? 3),
		actionType: (step?.actionType as WarnPunishmentActionName | undefined) ?? 'MUTE',
		duration: formatDurationInput(step?.durationSeconds ?? null),
	}));
	const [errors, setErrors] = useState<StepFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: steps, error: stepsError } = useAutomoderatorWarnPunishments(guildId);
	const setStep = useSetAutomoderatorWarnPunishment(guildId);
	const deleteStep = useDeleteAutomoderatorWarnPunishment(guildId);

	const updateField = <TField extends keyof StepFormData>(field: TField, value: StepFormData[TField]) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
		setSuccessMessage(null);
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		const warns = Number(form.warns.trim());
		if (!Number.isInteger(warns) || warns < 1 || warns > WARN_PUNISHMENT_MAX_WARNS) {
			setErrors({ warns: `Pick a whole number between 1 and ${WARN_PUNISHMENT_MAX_WARNS}.` });
			return;
		}

		// The list has to have loaded before a count can be claimed, or this would silently overwrite a step
		// somebody else already configured at that number.
		if (steps === undefined) {
			setErrors({
				warns: stepsError
					? "Couldn't load this server's existing steps, so picking a number isn't safe right now. Reload and try again."
					: "Still loading this server's existing steps.",
			});
			return;
		}

		if (warns !== step?.warns && steps.some((candidate) => candidate.warns === warns)) {
			setErrors({ warns: 'There is already a step at that number of warnings.' });
			return;
		}

		const parsed = parseDurationInput(form.duration, form.actionType);
		if (!parsed.ok) {
			setErrors({ duration: parsed.message });
			return;
		}

		setSuccessMessage(null);

		try {
			await setStep.mutateAsync({ warns, actionType: form.actionType, durationSeconds: parsed.seconds });

			// PUT then DELETE, like the reward form's retarget: the new row exists before the old one goes, so a
			// failure between them leaves a duplicate step rather than no step at all.
			if (step && warns !== step.warns) {
				await deleteStep.mutateAsync(step.warns);
				router.replace(`/dashboard/${guildId}/automoderator/warn-ladder`);
				return;
			}

			if (step) {
				setErrors({});
				setSuccessMessage('Step updated.');
				return;
			}

			router.replace(`/dashboard/${guildId}/automoderator/warn-ladder`);
		} catch (error) {
			setErrors(
				mapApiErrorToFieldErrors(error, {
					fields: STEP_FIELDS,
					fallbackField: 'warns',
					entityName: 'step',
					failureVerb: step ? 'update' : 'add',
				}),
			);
		}
	};

	const atLimit = !step && (steps?.length ?? 0) >= WARN_PUNISHMENT_MAX_COUNT;

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
					This server already has {WARN_PUNISHMENT_MAX_COUNT} steps. Remove one before adding another.
				</p>
			)}

			<div className="space-y-4">
				<TextField
					error={errors.warns}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Fires when a member reaches <em>exactly</em> this many active warnings. Pardoned warnings don&apos;t
							count, and a higher count later is a separate step.
						</p>
					}
					id="warn-step-warns"
					label="Warnings"
					max={WARN_PUNISHMENT_MAX_WARNS}
					min={1}
					onChange={(value) => updateField('warns', value)}
					type="number"
					value={form.warns}
				/>

				<div>
					<span
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						id="warn-step-action"
					>
						Punishment
					</span>
					<div
						aria-labelledby="warn-step-action"
						className="inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
						role="group"
					>
						{WARN_PUNISHMENT_ACTIONS.map((action) => (
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
				</div>

				<TextField
					disabled={DURATION_RULE[form.actionType] === 'forbidden'}
					error={errors.duration}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">{DURATION_HELP[form.actionType]}</p>
					}
					id="warn-step-duration"
					label="Duration"
					onChange={(value) => updateField('duration', value)}
					placeholder={DURATION_RULE[form.actionType] === 'required' ? '1h' : '7d'}
					value={DURATION_RULE[form.actionType] === 'forbidden' ? '' : form.duration}
				/>
			</div>

			<FormActions
				isSubmitDisabled={atLimit || steps === undefined}
				isSubmitting={setStep.isPending || deleteStep.isPending}
				onCancel={() => router.back()}
				pendingLabel={step ? 'Saving...' : 'Adding...'}
				submitLabel={step ? 'Save Changes' : 'Add Step'}
			/>
		</form>
	);
}

export function EditWarnPunishmentFormLoader() {
	const params = useParams<{ id: string; warns: string }>();
	const { data: steps, isLoading, error } = useAutomoderatorWarnPunishments(params.id);

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

	const step = steps.find((candidate) => String(candidate.warns) === params.warns);
	if (!step) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Step not found</p>
			</div>
		);
	}

	return <WarnPunishmentForm step={step} />;
}
