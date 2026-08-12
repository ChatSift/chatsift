'use client';

import { LEVEL_UP_NOTIFICATION_MODES, updateSocialConfigBodySchema } from '@chatsift/api/social-schemas';
import { DEFAULT_LEVEL_UP_MESSAGE } from '@chatsift/core';
import { ChannelType } from 'discord-api-types/v10';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SOCIAL_CONFIG_DEFAULTS, isTrackingConfigured } from '../../_components/socialConfig';
import { EligibilityExample } from './EligibilityExample';
import { XpCurvePreview } from './XpCurvePreview';
import { APIError } from '@/api/error';
import { mapIssuesToFieldErrors } from '@/api/formErrors';
import { useGuildInfo } from '@/api/routes/guilds';
import type { UpdateSocialConfigBody } from '@/api/routes/social';
import { useSocialConfig, useUpdateSocialConfig } from '@/api/routes/social';
import { Button } from '@/components/common/Button';
import { ChannelSelect } from '@/components/common/ChannelSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { cn } from '@/utils/util';

type LevelUpNotificationMode = (typeof LEVEL_UP_NOTIFICATION_MODES)[number];

interface SocialConfigFormData {
	levelUpNotificationFallbackChannelId: string;
	levelUpNotificationMessage: string;
	levelUpNotificationMode: LevelUpNotificationMode;
	requiredMessages: string;
	requiredMessagesTimespan: string;
	requiredXpBase: string;
	requiredXpMultiplier: string;
	/**
	 * Not a column -- the three fields the bot gates on are nullable as a unit, so the form models that trio as
	 * one switch rather than three inputs someone can half-fill. See `socialConfig.ts`.
	 */
	trackingEnabled: boolean;
	xpGain: string;
}

type SocialConfigFormErrors = Partial<Record<keyof SocialConfigFormData, string>>;

const CONFIG_FIELDS = [
	'requiredMessages',
	'requiredMessagesTimespan',
	'xpGain',
	'requiredXpBase',
	'requiredXpMultiplier',
	'levelUpNotificationMode',
	'levelUpNotificationFallbackChannelId',
	'levelUpNotificationMessage',
] as const satisfies (keyof SocialConfigFormData)[];

const NOTIFICATION_MODE_LABELS: Record<LevelUpNotificationMode, string> = {
	NONE: 'Off',
	DM: 'Direct message',
	CHANNEL: 'In the server',
};

const LEVEL_UP_PLACEHOLDERS = ['username', 'level', 'guildName', 'earnedRewards'] as const;

// Every numeric field below goes through a bare `Number`. `Number('')` is `0`, which each of them rejects with
// its own `min` error, so a blank required field lands on its own input with a message rather than failing the
// form as a whole.

export function SocialConfigForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const [form, setForm] = useState<SocialConfigFormData | null>(null);
	const [errors, setErrors] = useState<SocialConfigFormErrors>({});
	const [actionError, setActionError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: config, isLoading, error } = useSocialConfig(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'SOCIAL');
	const updateConfig = useUpdateSocialConfig(guildId);

	// Seed once, then leave alone: a background refetch after saving must not clobber whatever is being typed.
	// Same shape as `ModmailConfigForm`.
	useEffect(() => {
		if (config && form === null) {
			setForm({
				trackingEnabled: isTrackingConfigured(config),
				// Prefilled rather than left blank when unset, so switching tracking on is one click instead of
				// five guesses. Nothing here is persisted until the form is actually saved.
				requiredMessages: String(config.requiredMessages ?? SOCIAL_CONFIG_DEFAULTS.requiredMessages),
				requiredMessagesTimespan: String(
					config.requiredMessagesTimespan ?? SOCIAL_CONFIG_DEFAULTS.requiredMessagesTimespan,
				),
				xpGain: String(config.xpGain ?? SOCIAL_CONFIG_DEFAULTS.xpGain),
				requiredXpBase: String(config.requiredXpBase ?? SOCIAL_CONFIG_DEFAULTS.requiredXpBase),
				requiredXpMultiplier: String(config.requiredXpMultiplier ?? SOCIAL_CONFIG_DEFAULTS.requiredXpMultiplier),
				levelUpNotificationMode: config.levelUpNotificationMode,
				levelUpNotificationFallbackChannelId: config.levelUpNotificationFallbackChannelId ?? '',
				levelUpNotificationMessage: config.levelUpNotificationMessage ?? '',
			});
		}
	}, [config, form]);

	const updateField = <TField extends keyof SocialConfigFormData>(
		field: TField,
		value: SocialConfigFormData[TField],
	) => {
		setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	if (error && config === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !form) {
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
		const notificationFields = {
			levelUpNotificationMode: form.levelUpNotificationMode,
			levelUpNotificationMessage: form.levelUpNotificationMessage.trim() || null,
			// Only sent while it's the mode actually in use. Omitting it in the other two modes leaves a
			// previously-picked fallback in place, so flipping notifications off and back on doesn't quietly
			// throw the channel away.
			...(form.levelUpNotificationMode === 'CHANNEL' && {
				levelUpNotificationFallbackChannelId: form.levelUpNotificationFallbackChannelId || null,
			}),
		};

		const data: UpdateSocialConfigBody = form.trackingEnabled
			? {
					requiredMessages: Number(form.requiredMessages),
					requiredMessagesTimespan: Number(form.requiredMessagesTimespan),
					xpGain: Number(form.xpGain),
					// Always written alongside the gate, never independently: a guild tracking XP with no curve is a
					// state the bot tolerates (XP accrues, nobody ever levels) but nobody wants, so the dashboard
					// closes it instead of offering it as a third switch.
					requiredXpBase: Number(form.requiredXpBase),
					requiredXpMultiplier: Number(form.requiredXpMultiplier),
					...notificationFields,
				}
			: {
					requiredMessages: null,
					requiredMessagesTimespan: null,
					xpGain: null,
					// Curve deliberately left out rather than nulled -- turning tracking off shouldn't destroy a
					// curve that took thought to pick, and it does nothing on its own while the gate is closed.
					...notificationFields,
				};

		const result = updateSocialConfigBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapIssuesToFieldErrors(result.error.issues, CONFIG_FIELDS));
			return;
		}

		setActionError(null);
		setSuccessMessage(null);

		try {
			await updateConfig.mutateAsync(result.data as UpdateSocialConfigBody);
			setErrors({});
			setSuccessMessage('Configuration updated.');
		} catch (caughtError) {
			setActionError(
				caughtError instanceof APIError ? caughtError.message : 'Failed to update config. Please try again.',
			);
			console.error('Failed to update Social config:', caughtError);
		}
	};

	const previewBase = Number(form.requiredXpBase);
	const previewMultiplier = Number(form.requiredXpMultiplier);
	const previewXpGain = Number(form.xpGain);
	const previewRequiredMessages = Number(form.requiredMessages);
	const previewTimespan = Number(form.requiredMessagesTimespan);
	const canPreviewCurve = previewBase >= 1 && previewMultiplier >= 1;
	// Both worked examples below stay hidden while their inputs are mid-edit rather than narrating a half-typed
	// number back as though it were the configuration.
	const canPreviewEligibility = previewRequiredMessages >= 1 && previewTimespan >= 1 && previewXpGain >= 1;

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
					<label className="flex items-center gap-2" htmlFor="social-tracking-enabled">
						<input
							checked={form.trackingEnabled}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="social-tracking-enabled"
							onChange={(event) => updateField('trackingEnabled', event.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Enable XP tracking</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Off by default. While this is off Social is completely inert in this server -- nobody earns XP and no
						rewards are handed out. Everyone&apos;s existing XP is kept, so turning it back on resumes where you left
						off.
					</p>
				</div>

				{form.trackingEnabled && (
					<>
						<TextField
							error={errors.requiredMessages}
							helper={
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									How many messages it takes to earn anything. They have to arrive inside the window below, and the
									whole batch is worth one grant -- not one per message. This is what stops someone farming XP by
									spamming. Set it to 1 to award XP on every message instead, with no window and no cooldown.
								</p>
							}
							id="social-required-messages"
							label="Messages per grant"
							max={15}
							min={1}
							onChange={(value) => updateField('requiredMessages', value)}
							type="number"
							value={form.requiredMessages}
						/>

						<TextField
							error={errors.requiredMessagesTimespan}
							helper={
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									How long that batch has to arrive in, timed from its first message. It doubles as the cooldown: after
									a grant, the rest of that same window has to run out before a new batch starts counting, so nobody can
									ever earn more than once per this many seconds.
								</p>
							}
							id="social-required-messages-timespan"
							label="Window (seconds)"
							max={60}
							min={1}
							onChange={(value) => updateField('requiredMessagesTimespan', value)}
							type="number"
							value={form.requiredMessagesTimespan}
						/>

						<TextField
							error={errors.xpGain}
							helper={
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									What one grant is worth. Channel and role multipliers apply on top of this.
								</p>
							}
							id="social-xp-gain"
							label="XP per grant"
							min={1}
							onChange={(value) => updateField('xpGain', value)}
							type="number"
							value={form.xpGain}
						/>

						{canPreviewEligibility && (
							<EligibilityExample
								requiredMessages={previewRequiredMessages}
								timespanSeconds={previewTimespan}
								xpGain={previewXpGain}
							/>
						)}

						<div className="border-t border-on-secondary pt-4 dark:border-on-secondary-dark">
							<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Level curve</h3>
							<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
								Changing either of these re-levels everyone in the server against the new curve -- nobody loses XP, but
								the level their XP is worth moves. The table below is exactly what members will have to earn.
							</p>
						</div>

						<TextField
							error={errors.requiredXpBase}
							helper={
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									A one-time entry cost, charged once on the way to level 1.
								</p>
							}
							id="social-required-xp-base"
							label="XP to reach level 1"
							max={500}
							min={1}
							onChange={(value) => updateField('requiredXpBase', value)}
							type="number"
							value={form.requiredXpBase}
						/>

						<TextField
							error={errors.requiredXpMultiplier}
							helper={
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									How much more each level costs than the one before it.
								</p>
							}
							id="social-required-xp-multiplier"
							label="Extra XP per level"
							max={100}
							min={1}
							onChange={(value) => updateField('requiredXpMultiplier', value)}
							type="number"
							value={form.requiredXpMultiplier}
						/>

						{canPreviewCurve && (
							<XpCurvePreview
								base={previewBase}
								multiplier={previewMultiplier}
								xpGain={previewXpGain >= 1 ? previewXpGain : undefined}
							/>
						)}
					</>
				)}
			</div>

			<div className="space-y-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<div>
					<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Level-up notifications</h3>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						What happens when someone reaches a new level.
					</p>
					<div
						aria-label="Level-up notification mode"
						className="mt-2 inline-flex gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
						role="group"
					>
						{LEVEL_UP_NOTIFICATION_MODES.map((mode) => (
							<Button
								aria-pressed={form.levelUpNotificationMode === mode}
								className={cn(
									'rounded px-4 py-1.5 text-sm font-medium transition-colors',
									form.levelUpNotificationMode === mode
										? 'bg-misc-accent text-accent shadow-sm'
										: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
								)}
								key={mode}
								onPress={() => updateField('levelUpNotificationMode', mode)}
								type="button"
							>
								{NOTIFICATION_MODE_LABELS[mode]}
							</Button>
						))}
					</div>
					{errors.levelUpNotificationMode && (
						<p className="mt-1 text-sm text-misc-danger">{errors.levelUpNotificationMode}</p>
					)}
				</div>

				{form.levelUpNotificationMode === 'CHANNEL' && (
					<div>
						<ChannelSelect
							allowedTypes={[ChannelType.GuildText, ChannelType.GuildAnnouncement]}
							channels={channels}
							error={errors.levelUpNotificationFallbackChannelId}
							isLoading={isGuildInfoLoading}
							label="Fallback channel"
							onChange={(value) => updateField('levelUpNotificationFallbackChannelId', value ?? '')}
							selectedId="social-level-up-fallback-channel"
							value={form.levelUpNotificationFallbackChannelId}
						/>
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Level-ups are announced in the channel they happened in. This is only used when the bot can&apos;t post
							there. Leave blank to stay quiet instead.
						</p>
					</div>
				)}

				{form.levelUpNotificationMode !== 'NONE' && (
					<TextAreaField
						error={errors.levelUpNotificationMessage}
						helper={
							<>
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									Leave blank to use the default shown above. Nothing in it can ping anyone -- mentions are stripped
									before the message is sent.
								</p>
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									Supports placeholders:{' '}
									{LEVEL_UP_PLACEHOLDERS.map((placeholder, index) => (
										<span key={placeholder}>
											<code className="rounded bg-on-secondary px-1 py-0.5 text-xs dark:bg-on-secondary-dark">
												{`{{${placeholder}}}`}
											</code>
											{index < LEVEL_UP_PLACEHOLDERS.length - 1 ? ', ' : ''}
										</span>
									))}
								</p>
							</>
						}
						id="social-level-up-message"
						label="Message"
						maxLength={2_000}
						onChange={(value) => updateField('levelUpNotificationMessage', value)}
						placeholder={DEFAULT_LEVEL_UP_MESSAGE}
						rows={3}
						value={form.levelUpNotificationMessage}
					/>
				)}
			</div>

			<Button
				className="px-3 py-2.5 bg-misc-accent text-accent rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
				isDisabled={isGuildInfoLoading}
				onPress={handleSave}
				type="button"
			>
				Save Changes
			</Button>
		</div>
	);
}
