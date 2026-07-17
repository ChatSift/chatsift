'use client';

import { createAMAWithRawPromptSchema, createAMAWithRegularPromptSchema } from '@chatsift/api/ama-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { NormalPromptFields } from './NormalPromptFields';
import { PromptModeToggle } from './PromptModeToggle';
import { PromptPreview } from './PromptPreview';
import { RawPromptField } from './RawPromptField';
import { APIError } from '@/api/error';
import type { CreateAMABody } from '@/api/routes/ama';
import { useCreateAMA } from '@/api/routes/ama';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { Skeleton } from '@/components/common/Skeleton';

interface FormData {
	allowedQuestionUploads: string;
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

const TOP_LEVEL_FIELDS = [
	'title',
	'answersChannelId',
	'promptChannelId',
	'modQueueId',
	'flaggedQueueId',
	'guestQueueId',
	'allowedQuestionUploads',
] as const satisfies (keyof FormData)[];

const PROMPT_FIELD_MAP: Record<string, keyof FormData> = {
	description: 'description',
	plainText: 'plainText',
	imageURL: 'imageURL',
	thumbnailURL: 'thumbnailURL',
};

/**
 * Maps a failed `safeParse`'s issues back onto `FormData` keys so validation errors render exactly like the
 * per-field UI already expects, regardless of whether they came from this client-side parse or (via
 * `APIError.fieldError`) from the server re-validating the exact same schema.
 */
function mapIssuesToFormErrors(issues: readonly { message: string; path: PropertyKey[] }[]): FormErrors {
	const errors: FormErrors = {};

	for (const issue of issues) {
		const [first, second] = issue.path;

		if (typeof first === 'string' && (TOP_LEVEL_FIELDS as readonly string[]).includes(first)) {
			errors[first as keyof FormData] ??= issue.message;
		} else if (first === 'prompt' && typeof second === 'string' && second in PROMPT_FIELD_MAP) {
			errors[PROMPT_FIELD_MAP[second]!] ??= issue.message;
		} else if (first === 'prompt_raw') {
			errors.promptRaw ??= issue.message;
		}
	}

	return errors;
}

const allowedChannelTypes = [ChannelType.GuildText, ...threadTypes];

const CHANNEL_FIELDS = [
	{ key: 'answersChannelId', label: 'Answers Channel' },
	{ key: 'promptChannelId', label: 'Prompt Channel' },
	{ key: 'modQueueId', label: 'Mod Queue' },
	{ key: 'flaggedQueueId', label: 'Flagged Queue' },
	{ key: 'guestQueueId', label: 'Guest Queue' },
] as const satisfies { key: keyof FormData; label: string }[];

export function CreateAMAForm() {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const { id: guildId } = params;

	const { data: guildInfo, isLoading } = useGuildInfo(guildId, 'AMA');
	const createAMA = useCreateAMA(guildId);

	const [promptMode, setPromptMode] = useState<'normal' | 'raw'>('normal');
	const [formData, setFormData] = useState<FormData>({
		title: '',
		answersChannelId: '',
		promptChannelId: '',
		modQueueId: '',
		flaggedQueueId: '',
		guestQueueId: '',
		allowedQuestionUploads: '0',
		description: '',
		plainText: '',
		imageURL: '',
		thumbnailURL: '',
		promptRaw: '',
	});
	const [errors, setErrors] = useState<FormErrors>({});
	const [generalError, setGeneralError] = useState<string | null>(null);

	const updateFormData = (field: keyof FormData, value: string | undefined) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	// Non-blocking: picking the same channel for two different purposes is legal (the API doesn't reject it) but
	// is easy to do by accident with five near-identical selects, so we flag it instead of silently accepting it.
	const duplicateChannelWarning = useMemo(() => {
		const seen = new Map<string, string>();
		for (const { key, label } of CHANNEL_FIELDS) {
			const value = formData[key];
			if (!value) continue;

			const clashLabel = seen.get(value);
			if (clashLabel) {
				return `${clashLabel} and ${label} are set to the same channel.`;
			}

			seen.set(value, label);
		}

		return null;
	}, [formData]);

	const buildBody = (): { data: Record<string, unknown> } => {
		const base: Record<string, unknown> = {
			title: formData.title,
			answersChannelId: formData.answersChannelId,
			promptChannelId: formData.promptChannelId,
			modQueueId: formData.modQueueId || null,
			flaggedQueueId: formData.flaggedQueueId || null,
			guestQueueId: formData.guestQueueId || null,
			allowedQuestionUploads: Number.parseInt(formData.allowedQuestionUploads, 10),
		};

		// Only called after `validateForm` has already confirmed `formData.promptRaw` is valid JSON (or empty).
		if (promptMode === 'raw') {
			return { data: { ...base, prompt_raw: formData.promptRaw ? JSON.parse(formData.promptRaw) : {} } };
		}

		return {
			data: {
				...base,
				prompt: {
					description: formData.description || undefined,
					plainText: formData.plainText || undefined,
					imageURL: formData.imageURL || undefined,
					thumbnailURL: formData.thumbnailURL || undefined,
				},
			},
		};
	};

	const validateForm = (): CreateAMABody | undefined => {
		if (promptMode === 'raw' && formData.promptRaw && !isValidJSON(formData.promptRaw)) {
			setErrors({ promptRaw: 'Must be valid JSON' });
			setGeneralError(null);
			return undefined;
		}

		const { data } = buildBody();
		const schema = promptMode === 'raw' ? createAMAWithRawPromptSchema : createAMAWithRegularPromptSchema;
		const result = schema.safeParse(data);

		if (!result.success) {
			setErrors(mapIssuesToFormErrors(result.error.issues));
			setGeneralError(null);
			return undefined;
		}

		setErrors({});
		return result.data as CreateAMABody;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const body = validateForm();
		if (!body) {
			return;
		}

		setGeneralError(null);

		try {
			await createAMA.mutateAsync(body);
			router.replace(`/dashboard/${guildId}/ama/amas`);
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 422) {
				// `badData` from createAMA.ts — Discord rejected the composed message (only reachable in raw mode,
				// since normal-mode prompts are always well-formed by construction).
				setGeneralError('Invalid prompt data. Please check your JSON data and try again.');
				return;
			}

			// A 400 here means the server's zod schema rejected the request even though our own client-side
			// validation (the exact same schema) passed — shouldn't normally happen, but map it the same way as a
			// defense-in-depth fallback (e.g. a schema version skew between client and server bundles).
			if (error instanceof APIError && error.statusCode === 400) {
				const promptField = promptMode === 'raw' ? 'prompt_raw' : 'prompt';
				const candidates: [keyof FormData, string | undefined][] = [
					['title', error.fieldError('title')],
					['answersChannelId', error.fieldError('answersChannelId')],
					['promptChannelId', error.fieldError('promptChannelId')],
					['modQueueId', error.fieldError('modQueueId')],
					['flaggedQueueId', error.fieldError('flaggedQueueId')],
					['guestQueueId', error.fieldError('guestQueueId')],
					['allowedQuestionUploads', error.fieldError('allowedQuestionUploads')],
					['description', error.fieldError(promptField, 'description')],
					['plainText', error.fieldError(promptField, 'plainText')],
					['imageURL', error.fieldError(promptField, 'imageURL')],
					['thumbnailURL', error.fieldError(promptField, 'thumbnailURL')],
				];

				const newErrors: FormErrors = Object.fromEntries(
					candidates.filter((entry): entry is [keyof FormData, string] => entry[1] !== undefined),
				);

				setErrors(newErrors);
				setGeneralError(Object.keys(newErrors).length > 0 ? null : error.message);
				return;
			}

			setGeneralError('An unknown error occurred. Please try again later.');
			console.error('Failed to create AMA:', error);
		}
	};

	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const pastedText = e.clipboardData.getData('text');

		try {
			const parsed = JSON.parse(pastedText);
			const formatted = JSON.stringify(parsed, null, 2);

			e.preventDefault();

			updateFormData('promptRaw', formatted);
		} catch {
			// Not valid JSON, let default paste happen
		}
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
			{generalError && <p className="mt-1 text-sm text-misc-danger">{generalError}</p>}

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
						onChange={(e) => updateFormData('title', e.target.value)}
						placeholder="AMA with renowed JP VA John Doe"
						type="text"
						value={formData.title}
					/>
					{errors.title && <p className="mt-1 text-sm text-misc-danger">{errors.title}</p>}
				</div>

				{duplicateChannelWarning && (
					<p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
						{duplicateChannelWarning}
					</p>
				)}

				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.answersChannelId}
					label="Answers Channel"
					onChange={(value) => updateFormData('answersChannelId', value)}
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
					onChange={(value) => updateFormData('promptChannelId', value)}
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
					onChange={(value) => updateFormData('modQueueId', value)}
					placeholder="Select a channel for mod queue"
					selectedId="modQueueId"
					value={formData.modQueueId}
				/>{' '}
				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.flaggedQueueId}
					label="Flagged Queue (optional)"
					onChange={(value) => updateFormData('flaggedQueueId', value)}
					placeholder="Select a channel for flagged questions"
					selectedId="flaggedQueueId"
					value={formData.flaggedQueueId}
				/>{' '}
				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.guestQueueId}
					label="Guest Queue (optional)"
					onChange={(value) => updateFormData('guestQueueId', value)}
					placeholder="Select a channel for guest queue"
					selectedId="guestQueueId"
					value={formData.guestQueueId}
				/>
				<div>
					<label
						className="block text-sm font-medium text-secondary dark:text-secondary-dark mb-2"
						htmlFor="allowedQuestionUploads"
					>
						Allowed Question Uploads
					</label>
					<input
						className="w-full px-3 py-2 border border-on-secondary dark:border-on-secondary-dark rounded-md bg-card dark:bg-card-dark text-primary dark:text-primary-dark focus:outline-none focus:ring-2 focus:ring-misc-accent focus:border-misc-accent"
						id="allowedQuestionUploads"
						max={10}
						min={0}
						onChange={(e) => updateFormData('allowedQuestionUploads', e.target.value)}
						placeholder="0"
						type="number"
						value={formData.allowedQuestionUploads}
					/>
					{errors.allowedQuestionUploads && (
						<p className="mt-1 text-sm text-misc-danger">{errors.allowedQuestionUploads}</p>
					)}
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Number of file attachments (0-10) users can include with their questions
					</p>
				</div>
			</div>

			{/* Prompt Mode Selection */}
			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Prompt Configuration</h2>

				<PromptModeToggle mode={promptMode} onModeChange={setPromptMode} />

				<div className="grid gap-6 lg:grid-cols-2">
					<div>
						{promptMode === 'normal' && (
							<NormalPromptFields
								description={formData.description}
								errors={errors}
								imageURL={formData.imageURL}
								onDescriptionChange={(value) => updateFormData('description', value)}
								onImageURLChange={(value) => updateFormData('imageURL', value)}
								onPlainTextChange={(value) => updateFormData('plainText', value)}
								onThumbnailURLChange={(value) => updateFormData('thumbnailURL', value)}
								plainText={formData.plainText}
								thumbnailURL={formData.thumbnailURL}
							/>
						)}

						{promptMode === 'raw' && (
							<RawPromptField
								error={errors.promptRaw}
								onFormatClick={() => {
									try {
										const parsed = JSON.parse(formData.promptRaw);
										updateFormData('promptRaw', JSON.stringify(parsed, null, 2));
									} catch {
										// Invalid JSON, ignore
									}
								}}
								onPaste={handlePaste}
								onValueChange={(value) => updateFormData('promptRaw', value)}
								value={formData.promptRaw}
							/>
						)}
					</div>

					{promptMode === 'normal' ? (
						<PromptPreview
							description={formData.description}
							imageURL={formData.imageURL}
							mode="normal"
							plainText={formData.plainText}
							thumbnailURL={formData.thumbnailURL}
							title={formData.title}
						/>
					) : (
						<PromptPreview mode="raw" raw={formData.promptRaw} />
					)}
				</div>
			</div>

			<div className="flex gap-4">
				<Button
					className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
					isDisabled={createAMA.isPending}
					type="submit"
				>
					{createAMA.isPending ? 'Creating...' : 'Create AMA Session'}
				</Button>
				<Button
					className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
					onPress={() => router.back()}
					type="button"
				>
					Cancel
				</Button>
			</div>
		</form>
	);
}

function isValidJSON(value: string): boolean {
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}
