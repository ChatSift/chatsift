'use client';

import { automoderatorReportPresetsChannel, REPORT_PRESET_MAX_COUNT, REPORT_PRESET_MAX_LENGTH } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import {
	useAutomoderatorReportPresets,
	useCreateAutomoderatorReportPreset,
	useDeleteAutomoderatorReportPreset,
	useUpdateAutomoderatorReportPreset,
} from '@/api/routes/automoderatorReports';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { buttonClass } from '@/components/common/buttonStyles';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

function PresetRow({ guildId, preset }: { readonly guildId: string; readonly preset: { id: number; reason: string } }) {
	const updatePreset = useUpdateAutomoderatorReportPreset(guildId);
	const deletePreset = useDeleteAutomoderatorReportPreset(guildId);

	const [reason, setReason] = useState(preset.reason);
	const [error, setError] = useState<string | null>(null);

	const isDirty = reason.trim() !== preset.reason && reason.trim().length > 0;

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary p-3 dark:border-on-secondary-dark sm:flex-row sm:items-end">
			<div className="flex-1">
				<TextField
					error={error ?? undefined}
					id={`report-preset-${preset.id}`}
					label="Reason"
					maxLength={REPORT_PRESET_MAX_LENGTH}
					onChange={(value) => {
						setReason(value);
						setError(null);
					}}
					value={reason}
				/>
			</div>

			<div className="flex gap-2">
				<Button
					className={buttonClass('primary', 'sm')}
					isDisabled={!isDirty || updatePreset.isPending}
					onPress={async () => {
						try {
							await updatePreset.mutateAsync({ presetId: preset.id, reason: reason.trim() });
						} catch (caughtError) {
							setError(caughtError instanceof APIError ? caughtError.message : 'Failed to save.');
						}
					}}
				>
					Save
				</Button>

				<Button
					className={buttonClass('secondary', 'sm')}
					isDisabled={deletePreset.isPending}
					onPress={async () => {
						try {
							await deletePreset.mutateAsync(preset.id);
						} catch (caughtError) {
							setError(caughtError instanceof APIError ? caughtError.message : 'Failed to remove.');
						}
					}}
				>
					Remove
				</Button>
			</div>
		</div>
	);
}

/**
 * The reasons the "Report Message with Reason" menu offers. Editing one only changes what future reporters see:
 * the chosen text is copied onto the report when it's filed, so nothing already in the queue is rewritten.
 */
export function ReportPresetsForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorReportPresetsChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.reportPresets(guildId) });
	});

	const { data: presets, isLoading, error } = useAutomoderatorReportPresets(guildId);
	const createPreset = useCreateAutomoderatorReportPreset(guildId);

	const [draft, setDraft] = useState('');
	const [createError, setCreateError] = useState<string | null>(null);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !presets) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const atLimit = presets.length >= REPORT_PRESET_MAX_COUNT;

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm text-secondary dark:text-secondary-dark">
				With no reasons set, the reason picker just asks reporters to type one. Discord's select menus hold{' '}
				{REPORT_PRESET_MAX_COUNT} options, which is the cap here too.
			</p>

			{presets.length === 0 ? (
				<EmptyState
					icon={<SvgAutoModerator height={28} width={28} />}
					subtitle="Add the reasons your staff triage by, so reporters pick from your vocabulary instead of writing prose."
					title="No preset reasons"
				/>
			) : (
				<div className="flex flex-col gap-3">
					{presets.map((preset) => (
						// Keyed on the text as well as the id, so a preset another moderator edits remounts this row
						// instead of leaving stale local text that `isDirty` would then offer to write back over theirs.
						<PresetRow guildId={guildId} key={`${preset.id}-${preset.reason}`} preset={preset} />
					))}
				</div>
			)}

			<div className="flex flex-col gap-2 border-t border-on-secondary pt-4 dark:border-on-secondary-dark sm:flex-row sm:items-end">
				<div className="flex-1">
					<TextField
						disabled={atLimit}
						error={createError ?? undefined}
						helper={atLimit ? `You already have ${REPORT_PRESET_MAX_COUNT} reasons.` : undefined}
						id="report-preset-new"
						label="Add a reason"
						maxLength={REPORT_PRESET_MAX_LENGTH}
						onChange={(value) => {
							setDraft(value);
							setCreateError(null);
						}}
						placeholder="Spam or advertising"
						value={draft}
					/>
				</div>

				<Button
					className={buttonClass('primary', 'sm')}
					isDisabled={atLimit || draft.trim().length === 0 || createPreset.isPending}
					onPress={async () => {
						try {
							await createPreset.mutateAsync({ reason: draft.trim() });
							setDraft('');
						} catch (caughtError) {
							setCreateError(caughtError instanceof APIError ? caughtError.message : 'Failed to add.');
						}
					}}
				>
					Add
				</Button>
			</div>
		</div>
	);
}
