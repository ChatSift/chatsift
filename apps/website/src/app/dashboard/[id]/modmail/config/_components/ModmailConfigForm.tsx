'use client';

import { updateConfigBodySchema } from '@chatsift/api/modmail-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FaExclamationTriangle } from 'react-icons/fa';
import { APIError } from '@/api/error';
import { useMe } from '@/api/routes/auth';
import { useGuildInfo } from '@/api/routes/guilds';
import type { ModmailConfig, UpdateModmailConfigBody } from '@/api/routes/modmail';
import { useModmailConfig, useUpdateModmailConfig } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { ChannelSelect } from '@/components/common/ChannelSelect';
import { RoleSelect } from '@/components/common/RoleSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { TemplatePlaceholdersHint } from '@/components/common/TemplatePlaceholdersHint';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { formatDate } from '@/utils/util';

interface ConfigFormData {
	alertRoleId: string;
	anonReplyLabel: string;
	defaultGreetingMessage: string;
	dmMode: boolean;
	farewellMessage: string;
	greetingBeforeOpener: boolean;
	maxConcurrentThreads: string;
	modForumId: string;
	nukeDelayMinutes: string;
	nukeEnabled: boolean;
	recordThreadContent: boolean;
	simpleMode: boolean;
}

type ConfigFormErrors = Partial<Record<keyof ConfigFormData, string>>;

const CONFIG_FIELDS = [
	'modForumId',
	'defaultGreetingMessage',
	'farewellMessage',
	'simpleMode',
	'alertRoleId',
	'anonReplyLabel',
	'maxConcurrentThreads',
	'nukeDelayMinutes',
	'greetingBeforeOpener',
	'recordThreadContent',
	'dmMode',
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
 * A raw snowflake is unfriendly to show directly in the "Enabled by" audit line -- `resolvedUser` is the
 * server-resolved `APIUser` (or the bare snowflake on a 404, e.g. a deleted account) the API now returns
 * alongside the raw id, see `getConfig.ts`/`updateConfig.ts`'s `recordThreadContentEnabledByUser`.
 */
function enabledByLabel(
	resolvedUser: ModmailConfig['recordThreadContentEnabledByUser'],
	fallbackId: string | null,
): string {
	if (!resolvedUser) {
		return fallbackId ?? 'unknown';
	}

	return typeof resolvedUser === 'string' ? resolvedUser : (resolvedUser.global_name ?? resolvedUser.username);
}

/**
 * A plain muted `<p>` reads as just more fine print next to a field's own description -- easy to skim
 * past exactly where it matters most (a setting silently doing nothing). Styled to actually stop the
 * eye instead: same treatment `ErrorBanner.tsx` uses for real errors, reused here for "this is
 * misleading, not broken."
 */
function DmModeCaveat({ children }: { readonly children: React.ReactNode }) {
	return (
		<p className="mt-2 flex items-start gap-2 rounded-md border border-misc-danger bg-misc-danger/10 p-2 text-sm text-misc-danger">
			<FaExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0" />
			<span>{children}</span>
		</p>
	);
}

export function ModmailConfigForm() {
	const params = useParams<{ id: string }>();
	const [form, setForm] = useState<ConfigFormData | null>(null);
	const [errors, setErrors] = useState<ConfigFormErrors>({});
	const [actionError, setActionError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: config, isLoading, error } = useModmailConfig(params.id);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(params.id, 'MODMAIL');
	const updateConfig = useUpdateModmailConfig(params.id);
	const { data: me } = useMe();

	// DM mode only makes sense for a guild running its own custom ModMail instance -- the public
	// deployment never reads `guild_settings.dm_mode` at all (see updateConfig.ts's matching 400).
	const isCustomInstance = (me?.guilds.find((guild) => guild.id === params.id)?.customInstanceId ?? null) !== null;

	// Seed local form state once the config loads; a background refetch after save must not clobber whatever the
	// user is currently typing, so this only runs while `form` is still unset.
	useEffect(() => {
		if (config && form === null) {
			setForm({
				modForumId: config.modForumId ?? '',
				defaultGreetingMessage: config.defaultGreetingMessage ?? '',
				farewellMessage: config.farewellMessage ?? '',
				simpleMode: config.simpleMode,
				alertRoleId: config.alertRoleId ?? '',
				anonReplyLabel: config.anonReplyLabel ?? '',
				maxConcurrentThreads: String(config.maxConcurrentThreads),
				nukeDelayMinutes: config.nukeDelayMinutes === null ? '' : String(config.nukeDelayMinutes),
				nukeEnabled: config.nukeDelayMinutes !== null,
				greetingBeforeOpener: config.greetingBeforeOpener,
				recordThreadContent: config.recordThreadContent,
				dmMode: config.dmMode,
			});
		}
	}, [config, form]);

	const updateField = <TField extends keyof ConfigFormData>(field: TField, value: ConfigFormData[TField]) => {
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
	const roles = guildInfo?.roles ?? [];

	const handleSave = async () => {
		const data: UpdateModmailConfigBody = {
			modForumId: form.modForumId || null,
			defaultGreetingMessage: form.defaultGreetingMessage || null,
			farewellMessage: form.farewellMessage || null,
			simpleMode: form.simpleMode,
			alertRoleId: form.alertRoleId || null,
			anonReplyLabel: form.anonReplyLabel || null,
			maxConcurrentThreads: Number(form.maxConcurrentThreads),
			nukeDelayMinutes: form.nukeEnabled ? Number(form.nukeDelayMinutes) : null,
			greetingBeforeOpener: form.greetingBeforeOpener,
			recordThreadContent: form.recordThreadContent,
			...(isCustomInstance ? { dmMode: form.dmMode } : {}),
		};

		const result = updateConfigBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapConfigIssues(result.error.issues));
			return;
		}

		setActionError(null);
		setSuccessMessage(null);

		try {
			await updateConfig.mutateAsync(result.data as UpdateModmailConfigBody);
			setErrors({});
			setSuccessMessage('Configuration updated.');
		} catch (caughtError) {
			setActionError(
				caughtError instanceof APIError ? caughtError.message : 'Failed to update config. Please try again.',
			);
			console.error('Failed to update ModMail config:', caughtError);
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
				<ChannelSelect
					allowedTypes={[ChannelType.GuildForum]}
					channels={channels}
					error={errors.modForumId}
					label="Mod Forum"
					onChange={(value) => updateField('modForumId', value ?? '')}
					selectedId="modmail-mod-forum"
					value={form.modForumId}
				/>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="modmail-default-greeting"
					>
						Default Greeting Message
					</label>
					<textarea
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="modmail-default-greeting"
						maxLength={2_000}
						onChange={(e) => updateField('defaultGreetingMessage', e.target.value)}
						rows={3}
						value={form.defaultGreetingMessage}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Posted in a ticket&apos;s private thread when its category doesn&apos;t set its own greeting.
					</p>
					<TemplatePlaceholdersHint />
					{errors.defaultGreetingMessage && (
						<p className="mt-1 text-sm text-misc-danger">{errors.defaultGreetingMessage}</p>
					)}
				</div>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="modmail-farewell"
					>
						Farewell Message
					</label>
					<textarea
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="modmail-farewell"
						maxLength={2_000}
						onChange={(e) => updateField('farewellMessage', e.target.value)}
						rows={3}
						value={form.farewellMessage}
					/>
					<TemplatePlaceholdersHint />
					{errors.farewellMessage && <p className="mt-1 text-sm text-misc-danger">{errors.farewellMessage}</p>}
				</div>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="modmail-anon-reply-label"
					>
						Anonymous Reply Label
					</label>
					<input
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="modmail-anon-reply-label"
						maxLength={100}
						onChange={(e) => updateField('anonReplyLabel', e.target.value)}
						placeholder="{{ guildName }} Team"
						type="text"
						value={form.anonReplyLabel}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Shown as the author on anonymous staff replies. Leave blank to use the default shown above.
					</p>
					<TemplatePlaceholdersHint placeholders={['guildName']} />
					{errors.anonReplyLabel && <p className="mt-1 text-sm text-misc-danger">{errors.anonReplyLabel}</p>}
				</div>

				<div>
					<RoleSelect
						error={errors.alertRoleId}
						label="Alert Role"
						onChange={(value) => updateField('alertRoleId', value ?? '')}
						roles={roles}
						selectedId="modmail-alert-role"
						value={form.alertRoleId}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Pinged when a new ticket comes in. Leave blank for no alert.
					</p>
				</div>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="modmail-max-concurrent-threads"
					>
						Max Concurrent Threads
					</label>
					<input
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="modmail-max-concurrent-threads"
						min={1}
						onChange={(e) => updateField('maxConcurrentThreads', e.target.value)}
						type="number"
						value={form.maxConcurrentThreads}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						How many tickets a single user may have open at once in this server, across all categories. Categories may
						only tighten this further, never raise it.
					</p>
					{form.dmMode && (
						<DmModeCaveat>Ignored while DM mode is on — a user is limited to one open ticket at a time.</DmModeCaveat>
					)}
					{errors.maxConcurrentThreads && (
						<p className="mt-1 text-sm text-misc-danger">{errors.maxConcurrentThreads}</p>
					)}
				</div>

				<div>
					<label className="flex items-center gap-2" htmlFor="modmail-nuke-enabled">
						<input
							checked={form.nukeEnabled}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="modmail-nuke-enabled"
							onChange={(e) => {
								const nukeEnabled = e.target.checked;
								setForm((prev) =>
									prev
										? {
												...prev,
												nukeEnabled,
												nukeDelayMinutes: nukeEnabled && !prev.nukeDelayMinutes ? '30' : prev.nukeDelayMinutes,
											}
										: prev,
								);
							}}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">
							Automatically Delete User's Private Thread After Close
						</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Off by default. The private thread is always locked when a ticket closes; when this is on, users effectively
						lose their access to past conversations they've had in ModMail.
					</p>
					{form.dmMode && (
						<DmModeCaveat>
							Ignored while DM mode is on — there is no private thread to delete there, a ticket's history just stays in
							your DM history with the user.
						</DmModeCaveat>
					)}
					{form.nukeEnabled && (
						<div className="mt-2">
							<label
								className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
								htmlFor="modmail-nuke-delay-minutes"
							>
								Deletion Delay (minutes)
							</label>
							<input
								className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
								id="modmail-nuke-delay-minutes"
								min={1}
								onChange={(e) => updateField('nukeDelayMinutes', e.target.value)}
								type="number"
								value={form.nukeDelayMinutes}
							/>
							<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
								How long after a ticket closes before the user&apos;s private thread is actually deleted, giving the
								user a window to view staff's final response(s).
							</p>
							{errors.nukeDelayMinutes && <p className="mt-1 text-sm text-misc-danger">{errors.nukeDelayMinutes}</p>}
						</div>
					)}
				</div>

				{/* <label className="flex items-center gap-2" htmlFor="modmail-simple-mode">
					<input
						checked={form.simpleMode}
						className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
						id="modmail-simple-mode"
						onChange={(e) => updateField('simpleMode', e.target.checked)}
						type="checkbox"
					/>
					<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Simple Mode</span>
				</label> */}

				<div>
					<label className="flex items-center gap-2" htmlFor="modmail-greeting-before-opener">
						<input
							checked={form.greetingBeforeOpener}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="modmail-greeting-before-opener"
							onChange={(e) => updateField('greetingBeforeOpener', e.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">
							Send Greeting Before Opener Message
						</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						When enabled, the greeting is posted before the user&apos;s own opening message is relayed to staff, instead
						of after.
					</p>
					{form.dmMode && (
						<DmModeCaveat>
							Ignored while DM mode is on — the greeting always posts after the opening message there.
						</DmModeCaveat>
					)}
				</div>

				{isCustomInstance && (
					<div>
						<label className="flex items-center gap-2" htmlFor="modmail-dm-mode">
							<input
								checked={form.dmMode}
								className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
								id="modmail-dm-mode"
								onChange={(e) => updateField('dmMode', e.target.checked)}
								type="checkbox"
							/>
							<span className="text-sm font-medium text-secondary dark:text-secondary-dark">DM Mode</span>
						</label>
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Users open a ticket by DMing the bot directly instead of clicking a panel button. Ticket panels go inert
							while this is on — nothing about them is deleted, and turning this back off restores them exactly as
							configured.
						</p>
					</div>
				)}

				<div className="rounded-lg border border-misc-danger bg-misc-danger/10 p-4">
					<label className="flex items-center gap-2" htmlFor="modmail-record-thread-content">
						<input
							checked={form.recordThreadContent}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="modmail-record-thread-content"
							onChange={(e) => updateField('recordThreadContent', e.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-primary dark:text-primary-dark">Record Full Thread Content</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Off by default. When enabled, all replies sent through the bot and all surrounding messages in the mod
						thread are recorded so staff can browse past threads in full on the dashboard. This is a real privacy
						decision - make sure your team has consented to conversations being stored this way before turning it on.
					</p>
					{config?.recordThreadContentEnabledAt && (
						<p className="mt-2 text-xs text-secondary dark:text-secondary-dark">
							Enabled by {enabledByLabel(config.recordThreadContentEnabledByUser, config.recordThreadContentEnabledBy)}{' '}
							on {formatDate(new Date(config.recordThreadContentEnabledAt))}.
						</p>
					)}
				</div>
			</div>

			<Button
				className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
				isDisabled={isGuildInfoLoading}
				onPress={handleSave}
				type="button"
			>
				Save Changes
			</Button>
		</div>
	);
}
