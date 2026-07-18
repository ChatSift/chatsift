'use client';

import { updateAMAConfigSchema } from '@chatsift/api/ama-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { FaChartBar } from 'react-icons/fa';
import { APIError } from '@/api/error';
import type { PossiblyMissingChannelInfo, UpdateAMABody } from '@/api/routes/ama';
import { useAMA, useRepostPrompt, useUpdateAMA } from '@/api/routes/ama';
import type { GuildChannelInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { getChannelIcon } from '@/utils/channels';
import { formatDate, parseIntegerInput } from '@/utils/util';

const channelName = (channel: GuildChannelInfo | PossiblyMissingChannelInfo | null) =>
	channel && 'name' in channel ? channel.name : 'Unknown';

const allowedChannelTypes = [ChannelType.GuildText, ...threadTypes];

interface ConfigFormData {
	allowedQuestionUploads: string;
	answersChannelId: string;
	flaggedQueueId: string;
	guestQueueId: string;
	modQueueId: string;
	title: string;
}

type ConfigFormErrors = Partial<Record<keyof ConfigFormData, string>>;

const CONFIG_FIELDS = [
	'title',
	'answersChannelId',
	'modQueueId',
	'flaggedQueueId',
	'guestQueueId',
	'allowedQuestionUploads',
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

function ChannelIcon({ channel }: { readonly channel: GuildChannelInfo | PossiblyMissingChannelInfo | null }) {
	if (!channel || !('type' in channel)) return null;
	const Icon = getChannelIcon(channel.type);
	return <Icon size={20} />;
}

export function AMADetails() {
	const params = useParams<{ amaId: string; id: string }>();
	const router = useRouter();
	const [showEndConfirm, setShowEndConfirm] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [configForm, setConfigForm] = useState<ConfigFormData | null>(null);
	const [configErrors, setConfigErrors] = useState<ConfigFormErrors>({});

	const { data: ama, isLoading, error } = useAMA(params.id, params.amaId);
	const {
		data: guildInfo,
		isLoading: isGuildInfoLoading,
		error: guildInfoError,
	} = useGuildInfo(params.id, 'AMA');
	const updateAMA = useUpdateAMA(params.id, params.amaId);
	const repostPrompt = useRepostPrompt(params.id, params.amaId);

	// See GrantsList.tsx for why this also checks `ama === undefined`: a background refetch failure keeps the
	// previously-cached session around, and that stale-but-present data should keep rendering (including any
	// in-progress edit form) rather than being replaced by the full error state.
	if (error && ama === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<div className="space-y-6">
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (!ama) {
		return (
			<div className="text-center py-12">
				<p className="text-xl text-secondary dark:text-secondary-dark">AMA session not found</p>
			</div>
		);
	}

	const startEdit = () => {
		setConfigForm({
			title: ama.title,
			answersChannelId: ama.answersChannel.id,
			modQueueId: ama.modQueueChannel?.id ?? '',
			flaggedQueueId: ama.flaggedQueueChannel?.id ?? '',
			guestQueueId: ama.guestQueueChannel?.id ?? '',
			allowedQuestionUploads: String(ama.allowedQuestionUploads),
		});
		setConfigErrors({});
		setActionError(null);
		setSuccessMessage(null);
	};

	const cancelEdit = () => {
		setConfigForm(null);
		setConfigErrors({});
	};

	const updateConfigField = (field: keyof ConfigFormData, value: string | undefined) => {
		setConfigForm((prev) => (prev ? { ...prev, [field]: value ?? '' } : prev));
		setConfigErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSaveConfig = async () => {
		if (!configForm) return;

		const data = {
			title: configForm.title,
			answersChannelId: configForm.answersChannelId,
			modQueueId: configForm.modQueueId || null,
			flaggedQueueId: configForm.flaggedQueueId || null,
			guestQueueId: configForm.guestQueueId || null,
			allowedQuestionUploads: parseIntegerInput(configForm.allowedQuestionUploads),
		};

		const result = updateAMAConfigSchema.safeParse(data);
		if (!result.success) {
			setConfigErrors(mapConfigIssues(result.error.issues));
			return;
		}

		setActionError(null);

		try {
			await updateAMA.mutateAsync(result.data as UpdateAMABody);
			setConfigForm(null);
			setConfigErrors({});
			setSuccessMessage('Configuration updated.');
		} catch (error) {
			setActionError(error instanceof APIError ? error.message : 'Failed to update AMA. Please try again.');
			console.error('Failed to update AMA config:', error);
		}
	};

	const handleEndAMA = async () => {
		if (!showEndConfirm) {
			setShowEndConfirm(true);
			return;
		}

		setActionError(null);

		try {
			await updateAMA.mutateAsync({ ended: true });
			router.push(`/dashboard/${params.id}/ama/amas`);
		} catch (error) {
			setActionError(error instanceof APIError ? error.message : 'Failed to end AMA. Please try again.');
			console.error('Failed to end AMA:', error);
		} finally {
			setShowEndConfirm(false);
		}
	};

	const handleRepostPrompt = async () => {
		setActionError(null);
		setSuccessMessage(null);

		try {
			await repostPrompt.mutateAsync();
			setSuccessMessage('Prompt message reposted.');
		} catch (error) {
			setActionError(error instanceof APIError ? error.message : 'Failed to repost the prompt. Please try again.');
			console.error('Failed to repost prompt:', error);
		}
	};

	const editing = configForm !== null;
	const channels = guildInfo?.channels ?? [];

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{actionError && (
				<p
					className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger lg:col-span-2"
					role="alert"
				>
					{actionError}
				</p>
			)}

			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent lg:col-span-2"
					role="status"
				>
					{successMessage}
				</p>
			)}

			{/* Session Information Card */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Session Information</h2>
					{!ama.ended && !editing && (
						<Button
							className="px-3 py-1.5 text-sm bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors disabled:opacity-50"
							isDisabled={isGuildInfoLoading || (guildInfo === undefined && Boolean(guildInfoError))}
							onPress={startEdit}
							type="button"
						>
							Edit
						</Button>
					)}
				</div>
				<div className="space-y-4">
					<div>
						<label className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor="edit-title">
							Title
						</label>
						{editing ? (
							<>
								<input
									className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
									id="edit-title"
									maxLength={255}
									onChange={(e) => updateConfigField('title', e.target.value)}
									type="text"
									value={configForm.title}
								/>
								{configErrors.title && <p className="mt-1 text-sm text-misc-danger">{configErrors.title}</p>}
							</>
						) : (
							<p className="text-lg text-primary dark:text-primary-dark">{ama.title}</p>
						)}
					</div>

					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Status</p>
						<span
							className={`inline-block rounded px-3 py-1 text-sm font-medium ${
								ama.ended ? 'bg-misc-danger/10 text-misc-danger' : 'bg-misc-accent/10 text-misc-accent'
							}`}
						>
							{ama.ended ? 'Ended' : 'Active'}
						</span>
					</div>

					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Questions</p>
						<p className="text-lg text-primary dark:text-primary-dark">
							{ama.questionCount} {ama.questionCount === 1 ? 'question' : 'questions'}
						</p>
					</div>

					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Created</p>
						<p className="text-lg text-primary dark:text-primary-dark">{formatDate(new Date(ama.createdAt))}</p>
					</div>

					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor="edit-allowed-uploads"
						>
							Allowed Uploads
						</label>
						{editing ? (
							<>
								<input
									className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
									id="edit-allowed-uploads"
									max={10}
									min={0}
									onChange={(e) => updateConfigField('allowedQuestionUploads', e.target.value)}
									type="number"
									value={configForm.allowedQuestionUploads}
								/>
								{configErrors.allowedQuestionUploads && (
									<p className="mt-1 text-sm text-misc-danger">{configErrors.allowedQuestionUploads}</p>
								)}
							</>
						) : (
							<p className="text-lg text-primary dark:text-primary-dark">
								{ama.allowedQuestionUploads} {ama.allowedQuestionUploads === 1 ? 'file' : 'files'} per question
							</p>
						)}
					</div>
				</div>
			</div>

			{/* Channels Card */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark mb-4">Channels</h2>
				<div className="space-y-4">
					{editing ? (
						<>
							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={channels}
								error={configErrors.answersChannelId}
								label="Answers Channel"
								onChange={(value) => updateConfigField('answersChannelId', value)}
								required
								selectedId="edit-answersChannelId"
								value={configForm.answersChannelId}
							/>

							<div>
								<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Prompt Channel</p>
								<div className="mt-1 flex items-center gap-3">
									<ChannelIcon channel={ama.promptChannel} />
									<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.promptChannel)}</p>
								</div>
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									Fixed to where the original prompt message was posted. If that message was deleted, use
									&quot;Repost Prompt Message&quot; below to recreate it in this same channel.
								</p>
							</div>

							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={channels}
								error={configErrors.modQueueId}
								label="Mod Queue (optional)"
								onChange={(value) => updateConfigField('modQueueId', value)}
								selectedId="edit-modQueueId"
								value={configForm.modQueueId}
							/>

							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={channels}
								error={configErrors.flaggedQueueId}
								label="Flagged Queue (optional)"
								onChange={(value) => updateConfigField('flaggedQueueId', value)}
								selectedId="edit-flaggedQueueId"
								value={configForm.flaggedQueueId}
							/>

							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={channels}
								error={configErrors.guestQueueId}
								label="Guest Queue (optional)"
								onChange={(value) => updateConfigField('guestQueueId', value)}
								selectedId="edit-guestQueueId"
								value={configForm.guestQueueId}
							/>
						</>
					) : (
						<>
							<div className="flex items-center gap-3">
								<ChannelIcon channel={ama.answersChannel} />
								<div>
									<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Answers Channel</p>
									<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.answersChannel)}</p>
								</div>
							</div>

							<div className="flex items-center gap-3">
								<ChannelIcon channel={ama.promptChannel} />
								<div>
									<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Prompt Channel</p>
									<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.promptChannel)}</p>
								</div>
							</div>

							{ama.modQueueChannel && (
								<div className="flex items-center gap-3">
									<ChannelIcon channel={ama.modQueueChannel} />
									<div>
										<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Mod Queue</p>
										<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.modQueueChannel)}</p>
									</div>
								</div>
							)}

							{ama.flaggedQueueChannel && (
								<div className="flex items-center gap-3">
									<ChannelIcon channel={ama.flaggedQueueChannel} />
									<div>
										<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Flagged Queue</p>
										<p className="text-base text-primary dark:text-primary-dark">
											{channelName(ama.flaggedQueueChannel)}
										</p>
									</div>
								</div>
							)}

							{ama.guestQueueChannel && (
								<div className="flex items-center gap-3">
									<ChannelIcon channel={ama.guestQueueChannel} />
									<div>
										<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Guest Queue</p>
										<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.guestQueueChannel)}</p>
									</div>
								</div>
							)}
						</>
					)}
				</div>
			</div>

			{editing && (
				<div className="flex gap-3 lg:col-span-2">
					<Button
						className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
						onPress={handleSaveConfig}
						type="button"
					>
						Save Changes
					</Button>
					<Button
						className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
						onPress={cancelEdit}
						type="button"
					>
						Cancel
					</Button>
				</div>
			)}

			{/* Prompt Message Status Card */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark lg:col-span-2">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark mb-4">Prompt Message Status</h2>
				<div className="space-y-4">
					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Message Status</p>
						<span
							className={`inline-block rounded px-3 py-1 text-sm font-medium ${
								ama.promptMessageExists ? 'bg-misc-accent/10 text-misc-accent' : 'bg-misc-danger/10 text-misc-danger'
							}`}
						>
							{ama.promptMessageExists ? 'Active on Discord' : 'Message Deleted'}
						</span>
					</div>

					{!ama.promptMessageExists && !ama.ended && (
						<div className="pt-2">
							<Button
								className="bg-misc-accent text-white rounded-md hover:bg-misc-accent/90 transition-colors disabled:opacity-50"
								onPress={handleRepostPrompt}
								type="button"
							>
								Repost Prompt Message
							</Button>
							<p className="mt-2 text-sm text-secondary dark:text-secondary-dark">
								This will create a new prompt message in the prompt channel.
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Analytics & Export Card — data lands in M3 (docs/roadmap/04-ama-complete.md); this reserves the slot. */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark lg:col-span-2">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark mb-4">Analytics &amp; Export</h2>
				<div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-on-secondary py-8 text-center dark:border-on-secondary-dark">
					<FaChartBar className="h-8 w-8 text-secondary dark:text-secondary-dark" />
					<p className="text-sm text-secondary dark:text-secondary-dark">
						Question analytics and CSV export are coming in a future update.
					</p>
				</div>
			</div>

			{/* Actions Card */}
			{!ama.ended && (
				<div className="rounded-lg border border-misc-danger/20 bg-card p-6 dark:border-misc-danger/20 dark:bg-card-dark lg:col-span-2">
					<h2 className="text-xl font-medium text-misc-danger mb-4">Danger Zone</h2>
					{showEndConfirm ? (
						<div className="space-y-4">
							<p className="text-base text-primary dark:text-primary-dark">
								Are you sure you want to end this AMA? This action is <strong>irreversible</strong>.
							</p>
							<div className="flex gap-3">
								<Button
									className="px-3 py-2.5 bg-misc-danger text-white rounded-md hover:bg-misc-danger/90 transition-colors disabled:opacity-50"
									onPress={handleEndAMA}
									type="button"
								>
									Yes, End AMA
								</Button>
								<Button
									className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
									onPress={() => setShowEndConfirm(false)}
									type="button"
								>
									Cancel
								</Button>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							<p className="text-base text-primary dark:text-primary-dark">
								Ending an AMA will prevent new questions from being submitted. This action cannot be undone.
							</p>
							<Button
								className="px-3 py-2.5 bg-misc-danger text-white rounded-md hover:bg-misc-danger/90 transition-colors"
								onPress={handleEndAMA}
								type="button"
							>
								End AMA Session
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
