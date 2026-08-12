'use client';

import { upsertSocialRewardBodySchema } from '@chatsift/api/social-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { mapApiErrorToFieldErrors, mapIssuesToFieldErrors } from '@/api/formErrors';
import { useGuildInfo } from '@/api/routes/guilds';
import type { SocialReward, UpsertSocialRewardBody } from '@/api/routes/social';
import { useSocialRewards, useUpsertSocialReward } from '@/api/routes/social';
import { FormActions } from '@/components/common/FormActions';
import { RoleSelect } from '@/components/common/RoleSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface RewardFormData {
	clean: boolean;
	level: string;
	roleId: string;
}

type RewardFormErrors = Partial<Record<keyof RewardFormData, string>>;

const REWARD_FIELDS = ['roleId', 'level', 'clean'] as const satisfies (keyof RewardFormData)[];

interface SocialRewardFormProps {
	/**
	 * The reward being edited, or `undefined` when adding one. A role rewards exactly one level (the table's
	 * primary key), so re-submitting a role that's already rewarded moves it rather than adding a second entry.
	 */
	readonly reward?: SocialReward | undefined;
}

export function SocialRewardForm({ reward }: SocialRewardFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<RewardFormData>(() => ({
		roleId: reward?.roleId ?? '',
		level: String(reward?.level ?? 5),
		clean: reward?.clean ?? false,
	}));
	const [errors, setErrors] = useState<RewardFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'SOCIAL');
	// See the channel form: a role can only reward one level, so picking one that's already rewarded here would
	// move that reward rather than adding a new one.
	const { data: configuredRewards } = useSocialRewards(guildId);
	const upsertReward = useUpsertSocialReward(guildId);

	const updateField = <TField extends keyof RewardFormData>(field: TField, value: RewardFormData[TField]) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		if (!form.roleId) {
			setErrors({ roleId: 'Pick a role' });
			return;
		}

		const data: UpsertSocialRewardBody = { level: Number(form.level), clean: form.clean };

		const result = upsertSocialRewardBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapIssuesToFieldErrors(result.error.issues, REWARD_FIELDS));
			setSuccessMessage(null);
			return;
		}

		setSuccessMessage(null);

		try {
			await upsertReward.mutateAsync({ roleId: form.roleId, body: result.data });

			if (reward) {
				setErrors({});
				setSuccessMessage('Reward updated.');
				return;
			}

			router.replace(`/dashboard/${guildId}/social/rewards`);
		} catch (error) {
			setErrors(
				mapApiErrorToFieldErrors(error, {
					fields: REWARD_FIELDS,
					fallbackField: 'roleId',
					entityName: 'reward',
					failureVerb: reward ? 'update' : 'add',
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
				{reward ? null : (
					<div>
						<RoleSelect
							disabledIds={configuredRewards?.map((configured) => configured.roleId)}
							disabledReason="already a reward"
							error={errors.roleId}
							label="Role"
							onChange={(value) => updateField('roleId', value ?? '')}
							required
							roles={guildInfo?.roles ?? []}
							selectedId="social-reward-role"
							value={form.roleId}
						/>
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Has to be a role the bot can actually hand out -- roles managed by another integration are rejected, and
							the bot&apos;s own highest role has to sit above this one on Discord.
						</p>
					</div>
				)}

				<TextField
					error={errors.level}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							The level at which members receive this role. Anyone already past it gets the role the next time they earn
							XP, not immediately.
						</p>
					}
					id="social-reward-level"
					label="Level"
					max={1_000}
					min={1}
					onChange={(value) => updateField('level', value)}
					type="number"
					value={form.level}
				/>

				<div>
					<label className="flex items-center gap-2" htmlFor="social-reward-clean">
						<input
							checked={form.clean}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="social-reward-clean"
							onChange={(event) => updateField('clean', event.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">
							Only one of these at a time
						</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						For a ladder of ranks where a member should only wear their current one. Reaching this level takes away the
						previous role that <em>also</em> has this ticked -- and only those. Rewards without it are a separate,
						purely additive set: they&apos;re never removed by a promotion, and they never get removed by one either.
					</p>
				</div>
			</div>

			<FormActions
				isSubmitDisabled={!form.roleId || (!reward && isGuildInfoLoading)}
				isSubmitting={upsertReward.isPending}
				onCancel={() => router.back()}
				pendingLabel={reward ? 'Saving...' : 'Adding...'}
				submitLabel={reward ? 'Save Changes' : 'Add Reward'}
			/>
		</form>
	);
}

export function EditSocialRewardFormLoader() {
	const params = useParams<{ id: string; roleId: string }>();
	const { data: rewards, isLoading, error } = useSocialRewards(params.id);

	if (error && rewards === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !rewards) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	const reward = rewards.find((candidate) => candidate.roleId === params.roleId);
	if (!reward) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Reward not found</p>
			</div>
		);
	}

	return <SocialRewardForm reward={reward} />;
}
