'use client';

import { upsertExperimentBodySchema } from '@chatsift/api/automoderator-schemas';
import { EXPERIMENT_BUCKET_COUNT } from '@chatsift/core';
import { mapApiErrorToFieldErrors, mapIssuesToFieldErrors } from '@chatsift/web-core/api/formErrors';
import { Button } from '@chatsift/web-core/components/Button';
import { FormActions } from '@chatsift/web-core/components/FormActions';
import { SnowflakeInput } from '@chatsift/web-core/components/SnowflakeInput';
import { TextField } from '@chatsift/web-core/components/TextField';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useState } from 'react';
import { rangeSharePercent } from './experimentRange';
import { useUpsertExperiment } from '@/api/routes/experiments';
import type { Experiment } from '@/api/routes/experiments';

/**
 * Mirrors `upsertExperiment.ts`'s params schema. Not importable -- that one is a route-local zod object rather
 * than part of the browser-safe schemas module -- so it is spelled out here and only here.
 */
const NAME_PATTERN = /^[\da-z]+(?:-[\da-z]+)*$/;

const MAX_OVERRIDES = 500;

interface FormData {
	name: string;
	rangeEnd: string;
	rangeStart: string;
}

type FormErrors = Partial<Record<keyof FormData | 'overrides', string>>;

interface ExperimentFormProps {
	/**
	 * The experiment being edited, or `undefined` when creating. Editing keeps the name fixed: it is the row's
	 * primary key *and* the string the gate is spelled with in code, so renaming through the dashboard would
	 * create a second experiment and silently switch the feature off.
	 */
	readonly existing?: Experiment | undefined;
	onDone(): void;
}

export function ExperimentForm({ existing, onDone }: ExperimentFormProps) {
	const isEditing = existing !== undefined;
	const [data, setData] = useState<FormData>({
		name: existing?.name ?? '',
		rangeStart: String(existing?.rangeStart ?? 0),
		rangeEnd: String(existing?.rangeEnd ?? 0),
	});
	const [overrides, setOverrides] = useState<string[]>(existing?.overrides ?? []);
	const [overrideDraft, setOverrideDraft] = useState('');
	const [errors, setErrors] = useState<FormErrors>({});

	const upsert = useUpsertExperiment();

	const rangeStart = Number(data.rangeStart);
	const rangeEnd = Number(data.rangeEnd);
	const hasReadableRange =
		Number.isInteger(rangeStart) && Number.isInteger(rangeEnd) && rangeStart >= 0 && rangeEnd >= rangeStart;

	const addOverride = () => {
		const guildId = overrideDraft.trim();
		if (!guildId) {
			return;
		}

		if (!/^\d{17,20}$/.test(guildId)) {
			setErrors((previous) => ({ ...previous, overrides: 'That is not a Discord ID' }));
			return;
		}

		// Silently a no-op rather than an error: re-adding a guild already listed is what an operator pasting
		// from a list does, and the API dedupes for the same reason.
		if (!overrides.includes(guildId)) {
			if (overrides.length >= MAX_OVERRIDES) {
				setErrors((previous) => ({ ...previous, overrides: `At most ${MAX_OVERRIDES} overrides` }));
				return;
			}

			setOverrides((previous) => [...previous, guildId]);
		}

		setOverrideDraft('');
		// Deleted rather than set to `undefined`: `exactOptionalPropertyTypes` treats those as different things.
		setErrors(({ overrides: _overrides, ...rest }) => rest);
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		const name = data.name.trim();
		if (!NAME_PATTERN.test(name)) {
			setErrors({ name: 'Lowercase letters, digits and single dashes only' });
			return;
		}

		// The same schema the route validates against, so a range the API would 400 on never leaves the page.
		const parsed = upsertExperimentBodySchema.safeParse({ rangeStart, rangeEnd, overrides });
		if (!parsed.success) {
			setErrors(mapIssuesToFieldErrors(parsed.error.issues, ['name', 'rangeStart', 'rangeEnd', 'overrides']));
			return;
		}

		try {
			await upsert.mutateAsync({ name, body: parsed.data });
			onDone();
		} catch (error) {
			setErrors(
				mapApiErrorToFieldErrors(error, {
					fields: ['name', 'rangeStart', 'rangeEnd', 'overrides'],
					fallbackField: 'name',
					entityName: 'experiment',
					failureVerb: isEditing ? 'update' : 'create',
				}),
			);
		}
	};

	return (
		<form
			className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark"
			onSubmit={handleSubmit}
		>
			<TextField
				disabled={isEditing}
				error={errors.name}
				helper={
					isEditing
						? 'The name is the gate as spelled in code, so it cannot be changed here.'
						: 'Must match the string passed to isExperimentEnabled, e.g. automod-filters.'
				}
				id="experiment-name"
				label="Name"
				maxLength={64}
				onChange={(value) => setData((previous) => ({ ...previous, name: value }))}
				placeholder="automod-filters"
				value={data.name}
			/>

			<div className="flex flex-col gap-2">
				<div className="grid grid-cols-2 gap-4">
					<TextField
						error={errors.rangeStart}
						id="experiment-range-start"
						label="Range start"
						max={EXPERIMENT_BUCKET_COUNT}
						min={0}
						onChange={(value) => setData((previous) => ({ ...previous, rangeStart: value }))}
						type="number"
						value={data.rangeStart}
					/>
					<TextField
						error={errors.rangeEnd}
						id="experiment-range-end"
						label="Range end"
						max={EXPERIMENT_BUCKET_COUNT}
						min={0}
						onChange={(value) => setData((previous) => ({ ...previous, rangeEnd: value }))}
						type="number"
						value={data.rangeEnd}
					/>
				</div>
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Buckets out of {EXPERIMENT_BUCKET_COUNT.toLocaleString()}, half-open, so the end bucket is excluded.{' '}
					{hasReadableRange ? (
						<>
							This covers{' '}
							<span className="font-medium text-primary dark:text-primary-dark">
								{rangeSharePercent(rangeStart, rangeEnd)}
							</span>{' '}
							of guilds.
						</>
					) : null}
				</p>
				<div className="flex flex-wrap gap-2">
					{/* The two ends of a rollout, which are the ranges an operator actually types by hand: a
						collapsed range is the deploy-free kill switch, and a full one is "ship it to everyone". */}
					<Button
						className={buttonClass('secondary', 'sm')}
						onPress={() => setData((previous) => ({ ...previous, rangeStart: '0', rangeEnd: '0' }))}
						type="button"
					>
						Off (0%)
					</Button>
					<Button
						className={buttonClass('secondary', 'sm')}
						onPress={() =>
							setData((previous) => ({ ...previous, rangeStart: '0', rangeEnd: String(EXPERIMENT_BUCKET_COUNT) }))
						}
						type="button"
					>
						Everyone (100%)
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<SnowflakeInput
					error={errors.overrides}
					id="experiment-override"
					label="Overrides"
					onChange={setOverrideDraft}
					value={overrideDraft}
				/>
				<div className="flex items-start gap-2">
					<Button className={buttonClass('secondary', 'sm')} onPress={addOverride} type="button">
						Add guild
					</Button>
					<p className="text-sm text-secondary dark:text-secondary-dark">
						Always on for these guilds, whatever the range says. Saving replaces the whole list.
					</p>
				</div>
				{overrides.length > 0 && (
					<ul className="flex flex-col gap-1">
						{overrides.map((guildId) => (
							<li
								className="flex items-center justify-between gap-2 rounded-md bg-on-tertiary px-3 py-1.5 dark:bg-on-tertiary-dark"
								key={guildId}
							>
								<span className="font-mono text-sm text-primary dark:text-primary-dark">{guildId}</span>
								<Button
									className={buttonClass('danger', 'sm')}
									onPress={() => setOverrides((previous) => previous.filter((id) => id !== guildId))}
									type="button"
								>
									Remove
								</Button>
							</li>
						))}
					</ul>
				)}
			</div>

			<FormActions
				isSubmitting={upsert.isPending}
				onCancel={onDone}
				pendingLabel="Saving..."
				submitLabel={isEditing ? 'Save changes' : 'Create experiment'}
			/>
		</form>
	);
}
