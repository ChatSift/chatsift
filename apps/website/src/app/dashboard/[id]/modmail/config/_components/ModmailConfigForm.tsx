'use client';

import { updateConfigBodySchema } from '@chatsift/api/modmail-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APIError } from '@/api/error';
import { useGuildInfo } from '@/api/routes/guilds';
import type { UpdateModmailConfigBody } from '@/api/routes/modmail';
import { useModmailConfig, useUpdateModmailConfig } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { ChannelSelect } from '@/components/common/ChannelSelect';
import { RoleSelect } from '@/components/common/RoleSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface ConfigFormData {
	alertRoleId: string;
	defaultGreetingMessage: string;
	farewellMessage: string;
	modForumId: string;
	simpleMode: boolean;
}

type ConfigFormErrors = Partial<Record<keyof ConfigFormData, string>>;

const CONFIG_FIELDS = [
	'modForumId',
	'defaultGreetingMessage',
	'farewellMessage',
	'simpleMode',
	'alertRoleId',
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

export function ModmailConfigForm() {
	const params = useParams<{ id: string }>();
	const [form, setForm] = useState<ConfigFormData | null>(null);
	const [errors, setErrors] = useState<ConfigFormErrors>({});
	const [actionError, setActionError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: config, isLoading, error } = useModmailConfig(params.id);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(params.id, 'MODMAIL');
	const updateConfig = useUpdateModmailConfig(params.id);

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
					{errors.farewellMessage && <p className="mt-1 text-sm text-misc-danger">{errors.farewellMessage}</p>}
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

				<label className="flex items-center gap-2" htmlFor="modmail-simple-mode">
					<input
						checked={form.simpleMode}
						className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
						id="modmail-simple-mode"
						onChange={(e) => updateField('simpleMode', e.target.checked)}
						type="checkbox"
					/>
					<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Simple Mode</span>
				</label>
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
