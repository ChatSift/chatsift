'use client';

import { upsertSocialRoleBodySchema } from '@chatsift/api/social-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { mapApiErrorToFieldErrors, mapIssuesToFieldErrors } from '@/api/formErrors';
import { useGuildInfo } from '@/api/routes/guilds';
import type { SocialRole, UpsertSocialRoleBody } from '@/api/routes/social';
import { useSocialRoles, useUpsertSocialRole } from '@/api/routes/social';
import { FormActions } from '@/components/common/FormActions';
import { RoleSelect } from '@/components/common/RoleSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface RoleFormData {
	multiplier: string;
	roleId: string;
}

type RoleFormErrors = Partial<Record<keyof RoleFormData, string>>;

const ROLE_FIELDS = ['roleId', 'multiplier'] as const satisfies (keyof RoleFormData)[];

interface SocialRoleFormProps {
	/**
	 * The row being edited, or `undefined` when adding one -- same single-PUT arrangement as the channel form.
	 */
	readonly role?: SocialRole | undefined;
}

export function SocialRoleForm({ role }: SocialRoleFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<RoleFormData>(() => ({
		roleId: role?.roleId ?? '',
		multiplier: String(role?.multiplier ?? 2),
	}));
	const [errors, setErrors] = useState<RoleFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'SOCIAL');
	// See the channel form: the write is an upsert, so an already-configured role has to be unpickable here or
	// adding would silently overwrite it -- which also means not submitting until this list is actually known.
	const { data: configuredRoles, error: configuredRolesError } = useSocialRoles(guildId);
	const upsertRole = useUpsertSocialRole(guildId);

	const isAddBlocked = !role && configuredRoles === undefined;

	const updateField = (field: keyof RoleFormData, value: string) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		if (!form.roleId) {
			setErrors({ roleId: 'Pick a role' });
			return;
		}

		if (isAddBlocked) {
			setErrors({
				roleId: configuredRolesError
					? "Couldn't load this server's configured roles, so adding one isn't safe right now. Reload and try again."
					: 'Still loading this server’s configured roles.',
			});
			return;
		}

		const data: UpsertSocialRoleBody = { multiplier: Number(form.multiplier) };

		const result = upsertSocialRoleBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapIssuesToFieldErrors(result.error.issues, ROLE_FIELDS));
			setSuccessMessage(null);
			return;
		}

		setSuccessMessage(null);

		try {
			await upsertRole.mutateAsync({ roleId: form.roleId, body: result.data });

			if (role) {
				setErrors({});
				setSuccessMessage('Role updated.');
				return;
			}

			router.replace(`/dashboard/${guildId}/social/roles`);
		} catch (error) {
			setErrors(
				mapApiErrorToFieldErrors(error, {
					fields: ROLE_FIELDS,
					fallbackField: 'roleId',
					entityName: 'role',
					failureVerb: role ? 'update' : 'add',
				}),
			);
		}
	};

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent"
					role="status"
				>
					{successMessage}
				</p>
			)}

			<div className="space-y-4">
				{role ? null : (
					<RoleSelect
						disabledIds={configuredRoles?.map((configured) => configured.roleId)}
						disabledReason="already configured"
						error={errors.roleId}
						label="Role"
						onChange={(value) => updateField('roleId', value ?? '')}
						required
						roles={guildInfo?.roles ?? []}
						selectedId="social-role"
						value={form.roleId}
					/>
				)}

				<TextField
					error={errors.multiplier}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Multiplies the XP members holding this role earn. Every configured role a member has multiplies together,
							on top of the channel&apos;s own multiplier -- someone with two 2x roles in a 2x channel earns 8x.
						</p>
					}
					id="social-role-multiplier"
					label="XP multiplier"
					min={1}
					onChange={(value) => updateField('multiplier', value)}
					type="number"
					value={form.multiplier}
				/>
			</div>

			<FormActions
				isSubmitDisabled={!form.roleId || isAddBlocked || (!role && isGuildInfoLoading)}
				isSubmitting={upsertRole.isPending}
				onCancel={() => router.back()}
				pendingLabel={role ? 'Saving...' : 'Adding...'}
				submitLabel={role ? 'Save Changes' : 'Add Role'}
			/>
		</form>
	);
}

export function EditSocialRoleFormLoader() {
	const params = useParams<{ id: string; roleId: string }>();
	const { data: roles, isLoading, error } = useSocialRoles(params.id);

	if (error && roles === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !roles) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	const role = roles.find((candidate) => candidate.roleId === params.roleId);
	if (!role) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Role is not configured</p>
			</div>
		);
	}

	return <SocialRoleForm role={role} />;
}
