'use client';

import {
	createAMAWithRawPromptSchema,
	createAMAWithRegularPromptSchema,
	hasDiscordMessageSurface,
} from '@chatsift/api/ama-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { NormalPromptFields } from '../../_components/NormalPromptFields';
import type { PromptMode } from '../../_components/PromptModeToggle';
import { PromptModeToggle } from '../../_components/PromptModeToggle';
import { PromptPreview } from '../../_components/PromptPreview';
import { APIError } from '@/api/error';
import type { CreateAMABody } from '@/api/routes/ama';
import { useCreateAMA } from '@/api/routes/ama';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { hexToColor } from '@/components/common/ColorField';
import { FormActions } from '@/components/common/FormActions';
import { RawJsonField } from '@/components/common/RawJsonField';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { datetimeLocalValueToISOString, parseIntegerInput } from '@/utils/util';

interface FormData {
	allowedQuestionUploads: string;
	answersChannelId: string;
	// Mirrors `reviewEnabled`/`queueId`: the toggle lives in form state only, the API just sees a null
	// `answersChannelId` when it's off (#316).
	answersToDiscord: boolean;
	/**
	 * `#rrggbb`, or empty for "use the default" -- see `ColorField`.
	 */
	color: string;
	description: string;
	guestIds: string[];
	imageURL: string;
	plainText: string;
	preparedAnswersEnabled: boolean;
	promptChannelId: string;
	promptRaw: string;
	queueId: string;
	reviewEnabled: boolean;
	scheduledCloseAt: string;
	thumbnailURL: string;
	title: string;
}

type FormErrors = Partial<Record<keyof FormData, string>>;

const TOP_LEVEL_FIELDS = [
	'title',
	'answersChannelId',
	'promptChannelId',
	'queueId',
	'guestIds',
	'allowedQuestionUploads',
	'scheduledCloseAt',
] as const satisfies (keyof FormData)[];

const PROMPT_FIELD_MAP: Record<string, keyof FormData> = {
	description: 'description',
	plainText: 'plainText',
	imageURL: 'imageURL',
	thumbnailURL: 'thumbnailURL',
	color: 'color',
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
	{ key: 'queueId', label: 'Queue' },
] as const satisfies { key: keyof FormData; label: string }[];

export function CreateAMAForm() {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const { id: guildId } = params;

	const { data: guildInfo, isLoading, error: guildInfoError } = useGuildInfo(guildId, 'AMA');
	const createAMA = useCreateAMA(guildId);

	const [promptMode, setPromptMode] = useState<PromptMode>('normal');
	const [formData, setFormData] = useState<FormData>({
		title: '',
		answersChannelId: '',
		answersToDiscord: true,
		promptChannelId: '',
		queueId: '',
		allowedQuestionUploads: '0',
		description: '',
		plainText: '',
		imageURL: '',
		thumbnailURL: '',
		color: '',
		promptRaw: '',
		scheduledCloseAt: '',
		reviewEnabled: false,
		preparedAnswersEnabled: false,
		guestIds: [],
	});
	const [errors, setErrors] = useState<FormErrors>({});
	const [generalError, setGeneralError] = useState<string | null>(null);

	const updateFormData = (field: keyof FormData, value: string | undefined) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const updateCheckboxField = (
		field: 'answersToDiscord' | 'preparedAnswersEnabled' | 'reviewEnabled',
		value: boolean,
	) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		// Any of these three can be what made an uploads error stale (they're the inputs to
		// `uploadsDisabled`), so drop it rather than leaving a message about a rule that no longer applies.
		setErrors(({ allowedQuestionUploads: _cleared, ...rest }) => rest);
	};

	const updateGuestId = (index: number, value: string) => {
		setFormData((prev) => ({ ...prev, guestIds: prev.guestIds.map((id, i) => (i === index ? value : id)) }));
	};

	const addGuestId = () => {
		setFormData((prev) => ({ ...prev, guestIds: [...prev.guestIds, ''] }));
	};

	const removeGuestId = (index: number) => {
		setFormData((prev) => ({ ...prev, guestIds: prev.guestIds.filter((_id, i) => i !== index) }));
	};

	// The two channels as the API will actually see them -- a hidden select keeps its stale value, so
	// "unchecked" has to win over "still has a value" everywhere downstream (`buildBody`, the duplicate
	// warning, the uploads rule).
	const effectiveAnswersChannelId = formData.answersToDiscord ? formData.answersChannelId || null : null;
	const effectiveQueueId = formData.reviewEnabled ? formData.queueId || null : null;
	// Exactly the API's own rule (#316) rather than a re-derivation, so the field can't be enabled here and
	// then rejected server-side.
	const uploadsDisabled = !hasDiscordMessageSurface({
		answersChannelId: effectiveAnswersChannelId,
		queueId: effectiveQueueId,
	});

	// Non-blocking: picking the same channel for two different purposes is legal (the API doesn't reject it) but
	// is easy to do by accident with a few near-identical selects, so we flag it instead of silently accepting it.
	const duplicateChannelWarning = useMemo(() => {
		const seen = new Map<string, string>();
		for (const { key, label } of CHANNEL_FIELDS) {
			// The queue and answers fields only make it into the submitted body while their respective
			// toggles are on (see `buildBody`, which sends `null` regardless of the field's value otherwise)
			// -- flagging a clash against a channel that won't actually be sent would be a false positive.
			if (key === 'queueId' && !formData.reviewEnabled) continue;
			if (key === 'answersChannelId' && !formData.answersToDiscord) continue;

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
			// Null when "post answers to Discord" is off (#316) -- same stale-value handling as `queueId`.
			answersChannelId: effectiveAnswersChannelId,
			promptChannelId: formData.promptChannelId,
			// The queue's channel only makes it through while review is enabled -- unchecking it hides the
			// channel select but doesn't clear its stale value, so this is where that gets dropped rather
			// than sent along with reviewEnabled: false.
			queueId: effectiveQueueId,
			reviewEnabled: formData.reviewEnabled,
			preparedAnswersEnabled: formData.preparedAnswersEnabled,
			// Forced to 0 when there'd be no Discord message to hang attachments off -- the input is disabled
			// in that state, but a value typed before the toggles flipped would otherwise still be submitted.
			allowedQuestionUploads: uploadsDisabled ? 0 : parseIntegerInput(formData.allowedQuestionUploads),
			scheduledCloseAt: datetimeLocalValueToISOString(formData.scheduledCloseAt),
			guestIds: [...new Set(formData.guestIds.map((id) => id.trim()).filter(Boolean))],
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
					color: hexToColor(formData.color) ?? undefined,
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
					['queueId', error.fieldError('queueId')],
					['guestIds', error.fieldError('guestIds')],
					['allowedQuestionUploads', error.fieldError('allowedQuestionUploads')],
					['scheduledCloseAt', error.fieldError('scheduledCloseAt')],
					['description', error.fieldError(promptField, 'description')],
					['plainText', error.fieldError(promptField, 'plainText')],
					['imageURL', error.fieldError(promptField, 'imageURL')],
					['thumbnailURL', error.fieldError(promptField, 'thumbnailURL')],
					['color', error.fieldError(promptField, 'color')],
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

	// See GrantsList.tsx for why this also checks `guildInfo === undefined`: a background refetch failure keeps
	// the previously-cached channel list around, and that stale-but-present data should keep the form usable
	// rather than being replaced by the full error state.
	if (guildInfoError && guildInfo === undefined) {
		return <UserErrorHandler error={guildInfoError} />;
	}

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
				<TextField
					error={errors.title}
					id="title"
					label="Title *"
					maxLength={255}
					onChange={(value) => updateFormData('title', value)}
					placeholder="AMA with renowned JP VA John Doe"
					value={formData.title}
				/>
				{duplicateChannelWarning && (
					<p className="rounded-md border border-misc-warning/40 bg-misc-warning/10 px-3 py-2 text-sm text-misc-warning dark:text-misc-warning-dark">
						{duplicateChannelWarning}
					</p>
				)}
				<div>
					<label className="flex items-center gap-2" htmlFor="ama-answers-to-discord">
						<input
							checked={formData.answersToDiscord}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="ama-answers-to-discord"
							onChange={(e) => updateCheckboxField('answersToDiscord', e.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">
							Post answers to a Discord channel
						</span>
					</label>
					{formData.answersToDiscord ? (
						<div className="mt-2">
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
							/>
						</div>
					) : (
						<p className="mt-2 rounded-md border border-misc-accent/40 bg-misc-accent/10 px-3 py-2 text-sm text-misc-accent">
							Answers won&apos;t be posted to Discord at all - the public answers page will be the only place they show
							up. Share its link from this AMA&apos;s page once it&apos;s created.
						</p>
					)}
				</div>{' '}
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
				<div>
					<label className="flex items-center gap-2" htmlFor="ama-review-enabled">
						<input
							checked={formData.reviewEnabled}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="ama-review-enabled"
							onChange={(e) => updateCheckboxField('reviewEnabled', e.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Enable review</span>
					</label>
					{formData.reviewEnabled && (
						<div className="mt-2 space-y-3">
							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={guildInfo!.channels}
								error={errors.queueId}
								label="Queue (optional)"
								onChange={(value) => updateFormData('queueId', value)}
								placeholder="Select a channel for the queue"
								selectedId="queueId"
								value={formData.queueId}
							/>
							{!formData.queueId && (
								<p className="rounded-md border border-misc-accent/40 bg-misc-accent/10 px-3 py-2 text-sm text-misc-accent">
									No channel picked - review will be managed entirely from the dashboard, with no Discord message posted
									for it.
								</p>
							)}
						</div>
					)}
				</div>{' '}
				<div>
					<h3 className="text-xl font-medium text-primary dark:text-primary-dark">Guests (optional)</h3>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Known guest-answerer user IDs. Once at least one is added, &quot;answered by&quot; becomes a picker
						restricted to this list instead of a free-text ID. Editable any time.
					</p>
					{errors.guestIds && <p className="mt-1 text-sm text-misc-danger">{errors.guestIds}</p>}
					<div className="mt-2 space-y-2">
						{formData.guestIds.map((guestId, index) => (
							<div className="flex items-center gap-2" key={index}>
								<input
									aria-label={`Guest ${index + 1} user ID`}
									className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-sm text-primary focus:border-misc-accent focus:outline-none dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
									onChange={(e) => updateGuestId(index, e.target.value)}
									placeholder="Discord user ID"
									type="text"
									value={guestId}
								/>
								<Button
									aria-label={`Remove guest ${index + 1}`}
									className="h-9 shrink-0 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
									onPress={() => removeGuestId(index)}
									type="button"
								>
									Remove
								</Button>
							</div>
						))}
						<Button
							className="h-9 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
							onPress={addGuestId}
							type="button"
						>
							+ Add Guest
						</Button>
					</div>
				</div>
				<div>
					<label className="flex items-center gap-2" htmlFor="ama-prepared-answers-enabled">
						<input
							checked={formData.preparedAnswersEnabled}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="ama-prepared-answers-enabled"
							onChange={(e) => updateCheckboxField('preparedAnswersEnabled', e.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Enable prepared answers</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Decouples approving a question from posting it - an answer can be prepared ahead of time from the dashboard,
						and only goes out to the answers channel once you hit Send.
					</p>
				</div>
				<TextField
					disabled={uploadsDisabled}
					error={errors.allowedQuestionUploads}
					helper={
						uploadsDisabled ? (
							<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
								Unavailable for this configuration. Uploaded files live on the Discord message a question is posted to,
								and this AMA posts to neither an answers channel nor a review queue - there would be nowhere to keep
								them. Turn on either one to allow uploads.
							</p>
						) : (
							<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
								Number of file attachments (0-10) users can include with their questions
							</p>
						)
					}
					id="allowedQuestionUploads"
					label="Allowed Question Uploads"
					max={10}
					min={0}
					onChange={(value) => updateFormData('allowedQuestionUploads', value)}
					placeholder="0"
					type="number"
					value={uploadsDisabled ? '0' : formData.allowedQuestionUploads}
				/>
				<TextField
					error={errors.scheduledCloseAt}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Optional - automatically stops accepting new questions at this date/time. Can be changed later.
						</p>
					}
					id="scheduledCloseAt"
					label="Scheduled Close Date (optional)"
					onChange={(value) => updateFormData('scheduledCloseAt', value)}
					type="datetime-local"
					value={formData.scheduledCloseAt}
				/>
			</div>

			{/* Prompt Mode Selection */}
			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Prompt Configuration</h2>

				<PromptModeToggle mode={promptMode} onModeChange={setPromptMode} />

				<div className="grid gap-6 lg:grid-cols-2">
					<div>
						{promptMode === 'normal' && (
							<NormalPromptFields
								color={formData.color}
								description={formData.description}
								errors={errors}
								imageURL={formData.imageURL}
								onColorChange={(value) => updateFormData('color', value)}
								onDescriptionChange={(value) => updateFormData('description', value)}
								onImageURLChange={(value) => updateFormData('imageURL', value)}
								onPlainTextChange={(value) => updateFormData('plainText', value)}
								onThumbnailURLChange={(value) => updateFormData('thumbnailURL', value)}
								plainText={formData.plainText}
								thumbnailURL={formData.thumbnailURL}
							/>
						)}

						{promptMode === 'raw' && (
							<RawJsonField
								error={errors.promptRaw}
								id="promptRaw"
								label="Raw JSON Prompt"
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
							color={formData.color}
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

			<FormActions
				isSubmitting={createAMA.isPending}
				onCancel={() => router.back()}
				pendingLabel="Creating..."
				submitLabel="Create AMA Session"
			/>
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
