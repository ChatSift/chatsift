'use client';

import { upsertSocialChannelBodySchema } from '@chatsift/api/social-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { mapApiErrorToFieldErrors, mapIssuesToFieldErrors } from '@/api/formErrors';
import { useGuildInfo } from '@/api/routes/guilds';
import type { SocialChannel, UpsertSocialChannelBody } from '@/api/routes/social';
import { useSocialChannels, useUpsertSocialChannel } from '@/api/routes/social';
import { ChannelSelect } from '@/components/common/ChannelSelect';
import { FormActions } from '@/components/common/FormActions';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

/**
 * Categories are selectable on purpose: a row against a category applies to every channel under it (and to
 * threads, via their parent), which is the whole reason one row can silence a section of the server. Voice and
 * forum channels carry messages too, so they're in here alongside text.
 */
const ALLOWED_CHANNEL_TYPES = [
	ChannelType.GuildCategory,
	ChannelType.GuildText,
	ChannelType.GuildAnnouncement,
	ChannelType.GuildForum,
	ChannelType.GuildVoice,
	ChannelType.GuildStageVoice,
];

interface ChannelFormData {
	channelId: string;
	ignored: boolean;
	multiplier: string;
}

type ChannelFormErrors = Partial<Record<keyof ChannelFormData, string>>;

const CHANNEL_FIELDS = ['channelId', 'ignored', 'multiplier'] as const satisfies (keyof ChannelFormData)[];

interface SocialChannelFormProps {
	/**
	 * The row being edited, or `undefined` when adding one. The API is a single full-representation PUT keyed by
	 * the channel, so the two cases are the same request -- all that differs is whether the channel is still up
	 * for grabs (editing locks it, since changing it would mean writing a second row rather than moving this one).
	 */
	readonly channel?: SocialChannel | undefined;
}

export function SocialChannelForm({ channel }: SocialChannelFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<ChannelFormData>(() => ({
		channelId: channel?.channelId ?? '',
		ignored: channel?.ignored ?? false,
		multiplier: String(channel?.multiplier ?? 1),
	}));
	const [errors, setErrors] = useState<ChannelFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'SOCIAL');
	// Only needed by the add flow: the write is an upsert, so picking a channel that already has a row would
	// silently overwrite it instead of adding anything. Those channels stay listed but greyed out, which is
	// also how someone discovers the row already exists (it's edited from the list, not from here).
	const { data: configuredChannels } = useSocialChannels(guildId);
	const upsertChannel = useUpsertSocialChannel(guildId);

	const updateField = <TField extends keyof ChannelFormData>(field: TField, value: ChannelFormData[TField]) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		if (!form.channelId) {
			setErrors({ channelId: 'Pick a channel' });
			return;
		}

		const data: UpsertSocialChannelBody = {
			ignored: form.ignored,
			// Meaningless while the channel is ignored (nothing is granted at all), so it's normalised rather
			// than saved as a number that quietly comes back if the ignore is ever lifted.
			multiplier: form.ignored ? 1 : Number(form.multiplier),
		};

		const result = upsertSocialChannelBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapIssuesToFieldErrors(result.error.issues, CHANNEL_FIELDS));
			setSuccessMessage(null);
			return;
		}

		setSuccessMessage(null);

		try {
			await upsertChannel.mutateAsync({ channelId: form.channelId, body: result.data });

			if (channel) {
				setErrors({});
				setSuccessMessage('Channel updated.');
				return;
			}

			router.replace(`/dashboard/${guildId}/social/channels`);
		} catch (error) {
			setErrors(
				mapApiErrorToFieldErrors(error, {
					fields: CHANNEL_FIELDS,
					fallbackField: 'channelId',
					entityName: 'channel',
					failureVerb: channel ? 'update' : 'add',
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
				{channel ? null : (
					<ChannelSelect
						allowedTypes={ALLOWED_CHANNEL_TYPES}
						channels={guildInfo?.channels ?? []}
						disabledIds={configuredChannels?.map((configured) => configured.channelId)}
						disabledReason="already configured"
						error={errors.channelId}
						label="Channel"
						onChange={(value) => updateField('channelId', value ?? '')}
						required
						selectedId="social-channel"
						value={form.channelId}
					/>
				)}

				<div>
					<label className="flex items-center gap-2" htmlFor="social-channel-ignored">
						<input
							checked={form.ignored}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="social-channel-ignored"
							onChange={(event) => updateField('ignored', event.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Grant no XP here</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Messages here don&apos;t count towards anyone&apos;s XP at all -- not even towards the messages needed for a
						grant elsewhere.
					</p>
				</div>

				{form.ignored ? null : (
					<TextField
						error={errors.multiplier}
						helper={
							<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
								Multiplies the XP granted for messages here. Stacks on top of any role multipliers the member has. Leave
								it at 1 to configure only the ignore setting above.
							</p>
						}
						id="social-channel-multiplier"
						label="XP multiplier"
						max={10}
						min={1}
						onChange={(value) => updateField('multiplier', value)}
						type="number"
						value={form.multiplier}
					/>
				)}
			</div>

			<FormActions
				isSubmitDisabled={!form.channelId || (!channel && isGuildInfoLoading)}
				isSubmitting={upsertChannel.isPending}
				onCancel={() => router.back()}
				pendingLabel={channel ? 'Saving...' : 'Adding...'}
				submitLabel={channel ? 'Save Changes' : 'Add Channel'}
			/>
		</form>
	);
}

export function EditSocialChannelFormLoader() {
	const params = useParams<{ channelId: string; id: string }>();
	const { data: channels, isLoading, error } = useSocialChannels(params.id);

	if (error && channels === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !channels) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	const channel = channels.find((candidate) => candidate.channelId === params.channelId);
	if (!channel) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Channel is not configured</p>
			</div>
		);
	}

	return <SocialChannelForm channel={channel} />;
}
