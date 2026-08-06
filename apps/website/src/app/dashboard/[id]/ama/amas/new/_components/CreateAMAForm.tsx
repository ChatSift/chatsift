'use client';

import { createAMAWithRawPromptSchema, createAMAWithRegularPromptSchema } from '@chatsift/api/ama-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FaCheckCircle } from 'react-icons/fa';
import { NormalPromptFields } from '../../_components/NormalPromptFields';
import type { PromptMode } from '../../_components/PromptModeToggle';
import { PromptModeToggle } from '../../_components/PromptModeToggle';
import { PromptPreview } from '../../_components/PromptPreview';
import { APIError } from '@/api/error';
import { useGrantAuth } from '@/api/grant';
import type { CreateAMABody } from '@/api/routes/ama';
import { useCreateAMA } from '@/api/routes/ama';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { EmptyState } from '@/components/common/EmptyState';
import { FormActions } from '@/components/common/FormActions';
import { RawJsonField } from '@/components/common/RawJsonField';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { datetimeLocalValueToISOString, parseIntegerInput } from '@/utils/util';

interface FormData {
	allowedQuestionUploads: string;
	answersChannelId: string;
	description: string;
	flaggedQueueId: string;
	guestIds: string[];
	guestQueueId: string;
	imageURL: string;
	modQueueId: string;
	modReviewEnabled: boolean;
	plainText: string;
	preparedAnswersEnabled: boolean;
	promptChannelId: string;
	promptRaw: string;
	scheduledCloseAt: string;
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
	'guestIds',
	'allowedQuestionUploads',
	'scheduledCloseAt',
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
	const grant = useGrantAuth();

	const { data: guildInfo, isLoading, error: guildInfoError } = useGuildInfo(guildId, 'AMA');
	const createAMA = useCreateAMA(guildId);
	const [createdViaGrant, setCreatedViaGrant] = useState(false);

	const [promptMode, setPromptMode] = useState<PromptMode>('normal');
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
		scheduledCloseAt: '',
		modReviewEnabled: false,
		preparedAnswersEnabled: false,
		guestIds: [],
	});
	const [errors, setErrors] = useState<FormErrors>({});
	const [generalError, setGeneralError] = useState<string | null>(null);

	const updateFormData = (field: keyof FormData, value: string | undefined) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const updateCheckboxField = (field: 'modReviewEnabled' | 'preparedAnswersEnabled', value: boolean) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
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
			// A queue's channel only makes it through while its stage is enabled -- unchecking the stage
			// hides the channel select but doesn't clear its stale value, so this is where that gets
			// dropped rather than sent along with modReviewEnabled: false.
			modQueueId: formData.modReviewEnabled ? formData.modQueueId || null : null,
			// Flagging only ever happens from mod review, so this is dropped the same way modQueueId is.
			flaggedQueueId: formData.modReviewEnabled ? formData.flaggedQueueId || null : null,
			// Guest review has no dash-only mode -- it's just whether a channel is set, no separate toggle.
			guestQueueId: formData.guestQueueId || null,
			modReviewEnabled: formData.modReviewEnabled,
			preparedAnswersEnabled: formData.preparedAnswersEnabled,
			allowedQuestionUploads: parseIntegerInput(formData.allowedQuestionUploads),
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
			if (grant) {
				// No session to redirect a dashboard page for under the grant flow -- show an in-place success
				// message instead (the list page at `/dashboard/:guildId/ama/amas` isn't grant-accessible).
				setCreatedViaGrant(true);
			} else {
				router.replace(`/dashboard/${guildId}/ama/amas`);
			}
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 422) {
				// `badData` from createAMA.ts — Discord rejected the composed message (only reachable in raw mode,
				// since normal-mode prompts are always well-formed by construction).
				setGeneralError('Invalid prompt data. Please check your JSON data and try again.');
				return;
			}

			// Under the grant flow, a 401 here only ever means `isAuthed` rejected the token -- either it was
			// already claimed (a duplicate submit, or the link was already used to create an AMA) or it expired.
			// There's no session to fall back on, so the link itself is simply no longer usable.
			if (error instanceof APIError && error.statusCode === 401 && grant) {
				setGeneralError('This link has already been used or has expired. Ask for a new /ama create link.');
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
					['guestIds', error.fieldError('guestIds')],
					['allowedQuestionUploads', error.fieldError('allowedQuestionUploads')],
					['scheduledCloseAt', error.fieldError('scheduledCloseAt')],
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

	if (createdViaGrant) {
		return (
			<EmptyState
				icon={<FaCheckCircle className="h-8 w-8 text-secondary dark:text-secondary-dark" />}
				subtitle="You can close this tab now."
				title="AMA created"
			/>
		);
	}

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
				<div>
					<label className="flex items-center gap-2" htmlFor="ama-mod-review-enabled">
						<input
							checked={formData.modReviewEnabled}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="ama-mod-review-enabled"
							onChange={(e) => updateCheckboxField('modReviewEnabled', e.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Enable mod review</span>
					</label>
					{formData.modReviewEnabled && (
						<div className="mt-2 space-y-3">
							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={guildInfo!.channels}
								error={errors.modQueueId}
								label="Mod Queue (optional)"
								onChange={(value) => updateFormData('modQueueId', value)}
								placeholder="Select a channel for mod queue"
								selectedId="modQueueId"
								value={formData.modQueueId}
							/>
							{!formData.modQueueId && (
								<p className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-600 dark:text-blue-400">
									No channel picked - mod review will be managed entirely from the dashboard, with no Discord message
									posted for it.
								</p>
							)}
							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={guildInfo!.channels}
								error={errors.flaggedQueueId}
								label="Flagged Queue (optional)"
								onChange={(value) => updateFormData('flaggedQueueId', value)}
								placeholder="Select a channel for flagged questions"
								selectedId="flaggedQueueId"
								value={formData.flaggedQueueId}
							/>
						</div>
					)}
				</div>{' '}
				<div>
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
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Unlike mod review, guest review always happens in Discord -- guests generally don&apos;t have dashboard
						access. Leave this unset to skip the guest queue entirely; questions still get approved/answered from the
						dashboard.
					</p>
				</div>
				<div>
					<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Guests (optional)</span>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Known guest-answerer user IDs. Once at least one is added, &quot;answered by&quot; becomes a picker
						restricted to this list (in both the guest queue&apos;s Add Answer modal and the dashboard) instead of a
						free-text ID. Editable any time.
					</p>
					{errors.guestIds && <p className="mt-1 text-sm text-misc-danger">{errors.guestIds}</p>}
					<div className="mt-2 space-y-2">
						{formData.guestIds.map((guestId, index) => (
							<div className="flex items-center gap-2" key={index}>
								<input
									className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-sm text-primary focus:border-misc-accent focus:outline-none dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
									onChange={(e) => updateGuestId(index, e.target.value)}
									placeholder="Discord user ID"
									type="text"
									value={guestId}
								/>
								<Button
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
						Decouples approving a question from posting it - an answer can be prepared ahead of time (in the guest
						queue, or from the dashboard) and only goes out to the answers channel once you hit Send.
					</p>
				</div>
				<TextField
					error={errors.allowedQuestionUploads}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Number of file attachments (0-10) users can include with their questions
						</p>
					}
					id="allowedQuestionUploads"
					label="Allowed Question Uploads"
					max={10}
					min={0}
					onChange={(value) => updateFormData('allowedQuestionUploads', value)}
					placeholder="0"
					type="number"
					value={formData.allowedQuestionUploads}
				/>
				<TextField
					error={errors.scheduledCloseAt}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Optional - automatically ends the AMA at this date/time. Can be changed later.
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

			{/* Grant flow: `router.back()` would leave the flow and drop the one-time `?token=` param. */}
			<FormActions
				isSubmitting={createAMA.isPending}
				onCancel={() => router.back()}
				pendingLabel="Creating..."
				showCancel={!grant}
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
