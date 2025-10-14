'use client';

import type { GuildChannelInfo, PossiblyMissingChannelInfo } from '@chatsift/api';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgChannelText } from '@/components/icons/channels/SvgChannelText';
import { client } from '@/data/client';
import { getChannelIcon } from '@/utils/channels';
import { formatDate } from '@/utils/util';

const channelName = (channel: GuildChannelInfo | PossiblyMissingChannelInfo | null) =>
	channel && 'name' in channel ? channel.name : 'Unknown';

function ChannelIcon({ channel }: { readonly channel: GuildChannelInfo | PossiblyMissingChannelInfo | null }) {
	if (!channel || !('type' in channel)) return null;
	const Icon = getChannelIcon(channel.type);
	return <Icon size={20} />;
}

export function AMADetails() {
	const params = useParams<{ amaId: string; id: string }>();
	const router = useRouter();
	const [showEndConfirm, setShowEndConfirm] = useState(false);

	const { data: ama, isLoading } = client.guilds.ama.useAMA(params.id, params.amaId);
	const updateAMA = client.guilds.ama.useUpdateAMA(params.id, params.amaId);
	const repostPrompt = client.guilds.ama.useRepostPrompt(params.id, params.amaId);

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

	const handleEndAMA = async () => {
		if (!showEndConfirm) {
			setShowEndConfirm(true);
			return;
		}

		try {
			await updateAMA.mutateAsync({ ended: true });
			router.push(`/dashboard/${params.id}/ama/amas`);
		} catch (error) {
			console.error('Failed to end AMA:', error);
		} finally {
			setShowEndConfirm(false);
		}
	};

	const handleRepostPrompt = async () => {
		try {
			await repostPrompt.mutateAsync({});
		} catch (error) {
			console.error('Failed to repost prompt:', error);
		}
	};

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{/* Session Information Card */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark mb-4">Session Information</h2>
				<div className="space-y-4">
					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Title</p>
						<p className="text-lg text-primary dark:text-primary-dark">{ama.title}</p>
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
				</div>
			</div>

			{/* Channels Card */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark mb-4">Channels</h2>
				<div className="space-y-4">
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
								<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.flaggedQueueChannel)}</p>
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
				</div>
			</div>

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
