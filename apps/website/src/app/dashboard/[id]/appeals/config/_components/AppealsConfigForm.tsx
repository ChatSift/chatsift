'use client';

import { updateAppealsConfigBodySchema } from '@chatsift/api/appeals-schemas';
import { APPEAL_COOLDOWN_MAX_DAYS, APPEAL_MAX_APPEALS_CEILING, appealsConfigChannel } from '@chatsift/core';
import { APIError } from '@chatsift/web-core/api/error';
import { Button } from '@chatsift/web-core/components/Button';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { TextField } from '@chatsift/web-core/components/TextField';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useQueryClient } from '@tanstack/react-query';
import { ChannelType } from 'discord-api-types/v10';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppealQuestionsCard } from './AppealQuestionsCard';
import { queryKeys } from '@/api/queryClient';
import type { UpdateAppealsConfigBody } from '@/api/routes/appeals';
import { useAppealsConfig, useUpdateAppealsConfig } from '@/api/routes/appeals';
import { useGuildInfo } from '@/api/routes/guilds';
import { AppealLinkCopy } from '@/components/common/AppealLinkCopy';
import { ChannelSelect } from '@/components/common/ChannelSelect';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

interface ConfigFormData {
	autoRejoin: boolean;
	cooldownDays: string;
	/**
	 * The checkbox in front of `maxAppeals`. `NULL` means "no ceiling" and is the default, which no number in
	 * the box can express -- so the two are edited as a pair, the same shape ModMail's config uses for its
	 * nullable nuke delay.
	 */
	limitAppeals: boolean;
	maxAppeals: string;
	modChannelId: string;
}

type ConfigFormErrors = Partial<Record<keyof ConfigFormData, string>>;

const CONFIG_FIELDS = [
	'modChannelId',
	'cooldownDays',
	'maxAppeals',
	'autoRejoin',
] as const satisfies (keyof ConfigFormData)[];

function mapConfigIssues(issues: readonly { message: string; path: PropertyKey[] }[]): ConfigFormErrors {
	const errors: ConfigFormErrors = {};

	for (const issue of issues) {
		const [first] = issue.path;
		if (typeof first === 'string' && (CONFIG_FIELDS as readonly string[]).includes(first)) {
			errors[first as keyof ConfigFormData] ??= issue.message;
		}
	}

	return errors;
}

/**
 * Per-guild Appeals settings (#232 P2).
 *
 * `allow_timeout_appeals` exists on the row but is deliberately not offered here: timeouts are a different
 * shape from bans (decision 9) and nothing can appeal one until P9 ships the path, so a toggle for it would be
 * a setting that visibly does nothing. It gets its control when it gets its feature.
 */
export function AppealsConfigForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	const [form, setForm] = useState<ConfigFormData | null>(null);
	const [errors, setErrors] = useState<ConfigFormErrors>({});
	const [actionError, setActionError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	useRealtimeInvalidate(appealsConfigChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.appeals.config(guildId) });
	});

	const { data: config, isLoading, error } = useAppealsConfig(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'APPEALS');
	const updateConfig = useUpdateAppealsConfig(guildId);

	// Seeded once, for the same reason ModMail's config form seeds once: a background refetch after save must
	// not clobber whatever is currently being typed. `settings` is never `null` -- the API answers an
	// unconfigured guild with the shape a fresh row would have (see `getConfig.ts`), so the form shows what a
	// first save would actually write and needs no unconfigured branch of its own.
	useEffect(() => {
		if (config && form === null) {
			setForm({
				modChannelId: config.settings.modChannelId ?? '',
				cooldownDays: String(config.settings.cooldownDays),
				limitAppeals: config.settings.maxAppeals !== null,
				maxAppeals: String(config.settings.maxAppeals ?? 3),
				autoRejoin: config.settings.autoRejoin,
			});
		}
	}, [config, form]);

	const updateField = <TField extends keyof ConfigFormData>(field: TField, value: ConfigFormData[TField]) => {
		setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
		// The success banner claims the form matches what is saved, which the edit just made false -- so it goes
		// the moment anything changes. `actionError` deliberately stays: the usual reason somebody edits a field
		// right after a failed save is that the banner told them which field was wrong, and clearing it on the
		// first keystroke takes the instruction away mid-fix. It clears on the next save attempt instead.
		setSuccessMessage(null);
	};

	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !form || !config) {
		return (
			<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	const channels = guildInfo?.channels ?? [];

	const handleSave = async () => {
		// The one field with no defaultable value: `mod_channel_id` is `NOT NULL`, so there is no row to write
		// without it, and the API refuses a first save that omits it. Checked here rather than left to zod
		// because the schema has it `.optional()` -- absent means "unchanged", which is correct for every save
		// after the first and wrong for the first.
		if (!form.modChannelId) {
			setErrors({ modChannelId: 'Pick a channel where appeals should be posted.' });
			return;
		}

		// `Number('')` is `0`, which is a *valid* cooldown (appeal again immediately) -- so an empty box would
		// silently save a real setting nobody chose. Every other numeric field here has a `min` above zero and
		// is caught by the schema instead.
		if (form.cooldownDays.trim() === '') {
			setErrors({ cooldownDays: 'Enter a cooldown in days, or 0 to allow appealing again straight away.' });
			return;
		}

		const data: UpdateAppealsConfigBody = {
			modChannelId: form.modChannelId,
			cooldownDays: Number(form.cooldownDays),
			maxAppeals: form.limitAppeals ? Number(form.maxAppeals) : null,
			autoRejoin: form.autoRejoin,
		};

		const result = updateAppealsConfigBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapConfigIssues(result.error.issues));
			return;
		}

		setActionError(null);
		setSuccessMessage(null);

		try {
			await updateConfig.mutateAsync(result.data as UpdateAppealsConfigBody);
			setErrors({});
			setSuccessMessage('Configuration updated.');
		} catch (caughtError) {
			setActionError(
				caughtError instanceof APIError ? caughtError.message : 'Failed to update config. Please try again.',
			);
			console.error('Failed to update Appeals config:', caughtError);
		}
	};

	return (
		<div className="space-y-6">
			{actionError && (
				<p className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger" role="alert">
					{actionError}
				</p>
			)}

			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent"
					role="status"
				>
					{successMessage}
				</p>
			)}

			<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<div>
					<ChannelSelect
						allowedTypes={[ChannelType.GuildText, ChannelType.GuildForum]}
						channels={channels}
						error={errors.modChannelId}
						isLoading={isGuildInfoLoading}
						label="Appeals Channel"
						onChange={(value) => updateField('modChannelId', value ?? '')}
						required
						selectedId="appeals-mod-channel"
						value={form.modChannelId}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Where your moderators review appeals. A text channel gets one message per appeal with a thread on it; a
						forum gets one post per appeal. Either way it is a single message, edited in place as the appeal is decided.
					</p>
				</div>

				<TextField
					error={errors.cooldownDays}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							How long after a decision before the same person may appeal the same ban again. 0 lets them resubmit
							straight away; {APPEAL_COOLDOWN_MAX_DAYS} days is the maximum. To stop somebody appealing at all, add them
							to the unappealable list instead.
						</p>
					}
					id="appeals-cooldown-days"
					label="Re-appeal Cooldown (days)"
					max={APPEAL_COOLDOWN_MAX_DAYS}
					min={0}
					onChange={(value) => updateField('cooldownDays', value)}
					type="number"
					value={form.cooldownDays}
				/>

				<div>
					<label className="flex items-center gap-2" htmlFor="appeals-limit-appeals">
						<input
							checked={form.limitAppeals}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="appeals-limit-appeals"
							onChange={(event) => updateField('limitAppeals', event.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">
							Cap How Many Times One Ban Can Be Appealed
						</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Off by default, so the cooldown alone decides how often somebody may re-file. Turn this on to stop one
						person appealing the same ban forever.
					</p>
					{form.limitAppeals && (
						<div className="mt-2">
							<TextField
								error={errors.maxAppeals}
								helper={
									<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
										Counted per person, per ban. At most {APPEAL_MAX_APPEALS_CEILING}.
									</p>
								}
								id="appeals-max-appeals"
								label="Maximum Appeals"
								max={APPEAL_MAX_APPEALS_CEILING}
								min={1}
								onChange={(value) => updateField('maxAppeals', value)}
								type="number"
								value={form.maxAppeals}
							/>
						</div>
					)}
				</div>

				<div>
					<label className="flex items-center gap-2" htmlFor="appeals-auto-rejoin">
						<input
							checked={form.autoRejoin}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="appeals-auto-rejoin"
							onChange={(event) => updateField('autoRejoin', event.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">
							Put Approved Appellants Straight Back In
						</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Off by default. When on, approving an appeal unbans the person and adds them back to the server in one step,
						rather than unbanning them and DMing an invite. It needs their permission too, granted when they log in to
						appeal - whoever did not grant it gets the invite instead.
					</p>
				</div>
			</div>

			{config.appealLink && (
				<div className="space-y-3 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
					<div>
						<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Your appeal link</h2>
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Where a banned member goes to appeal. Put it wherever they will still see it once they are banned - a ban
							DM, your rules channel, your server description. AutoModerator can add it to every ban DM for you from{' '}
							<Link
								className="text-misc-accent hover:underline"
								href={`/dashboard/${guildId}/automoderator/punishment-notices`}
							>
								Punishment Notices
							</Link>
							.
						</p>
					</div>
					<AppealLinkCopy link={config.appealLink} />
				</div>
			)}

			<AppealQuestionsCard questions={config.questions} />

			<Button className={buttonClass('primary')} isDisabled={isGuildInfoLoading} onPress={handleSave} type="button">
				Save Changes
			</Button>
		</div>
	);
}
