'use client';

import type { CreateAMABody } from '@chatsift/api';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NormalPromptFields } from './NormalPromptFields';
import { PromptModeToggle } from './PromptModeToggle';
import { RawPromptField } from './RawPromptField';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { client } from '@/data/client';
import { APIError } from '@/utils/fetcher';

type PromptMode = 'normal' | 'raw';

interface FormData {
	answersChannelId: string;
	description: string;
	flaggedQueueId: string;
	guestQueueId: string;
	imageURL: string;
	modQueueId: string;
	plainText: string;
	promptChannelId: string;
	promptRaw: string;
	thumbnailURL: string;
	title: string;
}

type FormErrors = Partial<Record<keyof FormData, string>>;

function validateURL(value: string): string | undefined {
	if (!value) return undefined;

	try {
		new URL(value);
		return undefined;
	} catch {
		return 'Must be a valid URL';
	}
}

const allowedChannelTypes = [ChannelType.GuildText, ...threadTypes];

export function CreateAMAForm() {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const { id: guildId } = params;

	const [promptMode, setPromptMode] = useState<PromptMode>('normal');
	const [formData, setFormData] = useState<FormData>({
		title: '',
		answersChannelId: '',
		promptChannelId: '',
		modQueueId: '',
		flaggedQueueId: '',
		guestQueueId: '',
		description: '',
		plainText: '',
		imageURL: '',
		thumbnailURL: '',
		promptRaw: '',
	});
	const [errors, setErrors] = useState<FormErrors>({});

	const { data: guildInfo, isLoading } = client.guilds.useInfo(guildId, { for_bot: 'AMA', force_fresh: 'false' });
	const createAMA = client.guilds.ama.useCreateAMA(guildId);

	const validateForm = (): boolean => {
		const newErrors: FormErrors = {};

		if (!formData.title.trim()) {
			newErrors.title = 'This field is required';
		} else if (formData.title.length > 255) {
			newErrors.title = 'Title must be at most 255 characters';
		}

		if (!formData.answersChannelId) {
			newErrors.answersChannelId = 'This field is required';
		}

		if (!formData.promptChannelId) {
			newErrors.promptChannelId = 'This field is required';
		}

		// Normal mode validations
		if (promptMode === 'normal') {
			if (formData.description && formData.description.length > 4_000) {
				newErrors.description = 'Description must be at most 4000 characters';
			}

			if (formData.plainText && formData.plainText.length > 100) {
				newErrors.plainText = 'Plain text must be at most 100 characters';
			}

			const imageURLError = validateURL(formData.imageURL);
			if (imageURLError) newErrors.imageURL = imageURLError;

			const thumbnailURLError = validateURL(formData.thumbnailURL);
			if (thumbnailURLError) newErrors.thumbnailURL = thumbnailURLError;
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!validateForm()) {
			return;
		}

		try {
			const body = {
				title: formData.title,
				answersChannelId: formData.answersChannelId,
				promptChannelId: formData.promptChannelId,
				modQueueId: formData.modQueueId || null,
				flaggedQueueId: formData.flaggedQueueId || null,
				guestQueueId: formData.guestQueueId || null,
			} as CreateAMABody;

			if (promptMode === 'raw') {
				(body as any).prompt_raw = JSON.parse(formData.promptRaw);
			} else {
				(body as any).prompt = {
					description: formData.description || undefined,
					plainText: formData.plainText || undefined,
					imageURL: formData.imageURL || undefined,
					thumbnailURL: formData.thumbnailURL || undefined,
				};
			}

			await createAMA.mutateAsync(body);
			router.replace(`/dashboard/${guildId}/ama/amas`);
		} catch (error) {
			if (error instanceof APIError && error.payload.statusCode === 400) {
				console.error('Invalid prompt_raw data:', error);
			} else {
				console.error('Failed to create AMA:', error);
			}
		}
	};

	const formatJSON = () => {
		try {
			const parsed = JSON.parse(formData.promptRaw);
			setFormData({ ...formData, promptRaw: JSON.stringify(parsed, null, 2) });
		} catch {
			// Invalid JSON, ignore
		}
	};

	// TODO
	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		setTimeout(() => formatJSON(), 50);
	};

	if (isLoading) {
		return (
			<div className="mt-8 space-y-6">
				<div className="space-y-4">
					<Skeleton className="h-7 w-48" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
				<div className="space-y-4">
					<Skeleton className="h-7 w-56" />
					<Skeleton className="h-32 w-full" />
				</div>
			</div>
		);
	}

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			{/* Base Fields */}
			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Session Details</h2>
				<div>
					<label className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2" htmlFor="title">
						Title *
					</label>
					<input
						className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
						id="title"
						maxLength={255}
						onChange={(e) => setFormData({ ...formData, title: e.target.value })}
						placeholder="AMA with renowed JP VA John Doe"
						type="text"
						value={formData.title}
					/>
					{errors.title && <p className="mt-1 text-sm text-misc-danger">{errors.title}</p>}
				</div>
				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.answersChannelId}
					label="Answers Channel"
					onChange={(value) => setFormData({ ...formData, answersChannelId: value })}
					placeholder="Select the channel where answers will be posted"
					required
					selectedId="answersChannelId"
					value={formData.answersChannelId}
				/>{' '}
				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.promptChannelId}
					label="Prompt Channel"
					onChange={(value) => setFormData({ ...formData, promptChannelId: value })}
					placeholder="Select the channel where the prompt will be posted"
					required
					selectedId="promptChannelId"
					value={formData.promptChannelId}
				/>{' '}
				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.modQueueId}
					label="Mod Queue (optional)"
					onChange={(value) => setFormData({ ...formData, modQueueId: value })}
					placeholder="Select a channel for mod queue"
					selectedId="modQueueId"
					value={formData.modQueueId}
				/>{' '}
				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.flaggedQueueId}
					label="Flagged Queue (optional)"
					onChange={(value) => setFormData({ ...formData, flaggedQueueId: value })}
					placeholder="Select a channel for flagged questions"
					selectedId="flaggedQueueId"
					value={formData.flaggedQueueId}
				/>{' '}
				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.guestQueueId}
					label="Guest Queue (optional)"
					onChange={(value) => setFormData({ ...formData, guestQueueId: value })}
					placeholder="Select a channel for guest queue"
					selectedId="guestQueueId"
					value={formData.guestQueueId}
				/>
			</div>

			{/* Prompt Mode Selection */}
			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Prompt Configuration</h2>

				<PromptModeToggle mode={promptMode} onModeChange={setPromptMode} />

				{promptMode === 'normal' && (
					<NormalPromptFields
						description={formData.description}
						errors={errors}
						imageURL={formData.imageURL}
						onDescriptionChange={(value) => setFormData({ ...formData, description: value })}
						onImageURLChange={(value) => setFormData({ ...formData, imageURL: value })}
						onPlainTextChange={(value) => setFormData({ ...formData, plainText: value })}
						onThumbnailURLChange={(value) => setFormData({ ...formData, thumbnailURL: value })}
						plainText={formData.plainText}
						thumbnailURL={formData.thumbnailURL}
					/>
				)}

				{promptMode === 'raw' && (
					<RawPromptField
						onFormatClick={formatJSON}
						onPaste={handlePaste}
						onValueChange={(value) => setFormData({ ...formData, promptRaw: value })}
						value={formData.promptRaw}
					/>
				)}
			</div>

			{/* Submit Button */}
			<div className="flex gap-4">
				<Button
					className="px-6 py-3 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity"
					type="submit"
				>
					Create AMA Session
				</Button>
				<Button
					className="px-6 py-3 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
					onPress={() => router.back()}
					type="button"
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}
