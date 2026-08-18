'use client';

import {
	createReportPromptWithRawContentSchema,
	createReportPromptWithRegularContentSchema,
} from '@chatsift/api/automoderator-schemas';
import {
	REPORT_PROMPT_DEFAULT_BUTTON_LABEL,
	REPORT_PROMPT_DEFAULT_DESCRIPTION,
	REPORT_PROMPT_DEFAULT_TITLE,
} from '@chatsift/core';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import type { AutomoderatorReportPrompt, CreateAutomoderatorReportPromptBody } from '@/api/routes/automoderatorReports';
import {
	useCreateAutomoderatorReportPrompt,
	useUpdateAutomoderatorReportPrompt,
} from '@/api/routes/automoderatorReports';
import { useGuildInfo } from '@/api/routes/guilds';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { ColorField, hexToColor, validateColorInput } from '@/components/common/ColorField';
import { EmbedMessagePreview } from '@/components/common/EmbedMessagePreview';
import { FormActions } from '@/components/common/FormActions';
import { RawJsonField } from '@/components/common/RawJsonField';
import { Skeleton } from '@/components/common/Skeleton';
import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

/**
 * The stored `prompt_json_data`, which is the request body that produced the message. Parsed rather than
 * typed off the route, because the column is a `TEXT` snapshot and an older row may predate any field added
 * later -- everything here is therefore treated as optional and falls back to the defaults.
 */
interface StoredPrompt {
	prompt?: {
		buttonLabel?: string;
		color?: number;
		description?: string;
		imageUrl?: string;
		thumbnailUrl?: string;
		title?: string;
	};
	prompt_raw?: unknown;
}

interface FormData {
	buttonLabel: string;
	channelId: string;
	/**
	 * `#rrggbb`, or empty for "use the default" -- see `ColorField`.
	 */
	color: string;
	description: string;
	imageUrl: string;
	promptRaw: string;
	thumbnailUrl: string;
	title: string;
}

type FormErrors = Partial<Record<keyof FormData, string>>;

const allowedChannelTypes = [ChannelType.GuildText, ...threadTypes];

function colorToHex(color: number | undefined): string {
	return color === undefined ? '' : `#${color.toString(16).padStart(6, '0')}`;
}

function isValidJSON(value: string): boolean {
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}

/**
 * Prefilled with the real defaults rather than left blank, which is the point of this form: a guild that
 * changes nothing still gets the copy the feature was designed around, and anyone editing can see exactly what
 * they are editing away from. The API applies the same defaults for a field left empty, so clearing one is
 * "put it back" rather than "post an empty embed".
 */
function initialFormData(existing: AutomoderatorReportPrompt | undefined): FormData {
	const stored = existing ? (JSON.parse(existing.promptJsonData) as StoredPrompt) : undefined;

	return {
		channelId: existing?.channelId ?? '',
		title: stored?.prompt?.title ?? REPORT_PROMPT_DEFAULT_TITLE,
		description: stored?.prompt?.description ?? REPORT_PROMPT_DEFAULT_DESCRIPTION,
		buttonLabel: stored?.prompt?.buttonLabel ?? REPORT_PROMPT_DEFAULT_BUTTON_LABEL,
		imageUrl: stored?.prompt?.imageUrl ?? '',
		thumbnailUrl: stored?.prompt?.thumbnailUrl ?? '',
		color: colorToHex(stored?.prompt?.color),
		promptRaw: stored?.prompt_raw ? JSON.stringify(stored.prompt_raw, null, 2) : '',
	};
}

interface ReportPromptFormProps {
	/**
	 * Absent creates a new prompt. Present edits one, and the channel becomes read-only -- Discord cannot move a
	 * message between channels, so relocating a prompt is delete-and-post-again.
	 */
	readonly existing?: AutomoderatorReportPrompt;
}

export function ReportPromptForm({ existing }: ReportPromptFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const { data: guildInfo, isLoading, error: guildInfoError } = useGuildInfo(guildId, 'AUTOMODERATOR');
	const createPrompt = useCreateAutomoderatorReportPrompt(guildId);
	const updatePrompt = useUpdateAutomoderatorReportPrompt(guildId, existing?.id ?? 0);

	const [mode, setMode] = useState<'normal' | 'raw'>(() =>
		existing && (JSON.parse(existing.promptJsonData) as StoredPrompt).prompt_raw ? 'raw' : 'normal',
	);
	const [formData, setFormData] = useState<FormData>(() => initialFormData(existing));
	const [errors, setErrors] = useState<FormErrors>({});
	const [generalError, setGeneralError] = useState<string | null>(null);

	const updateFormData = (field: keyof FormData, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const buildBody = (): Record<string, unknown> => {
		const base = { channelId: formData.channelId };

		if (mode === 'raw') {
			return { ...base, prompt_raw: formData.promptRaw ? JSON.parse(formData.promptRaw) : {} };
		}

		return {
			...base,
			prompt: {
				// Empty means "use the default", which is exactly what omitting the field does server-side.
				title: formData.title || undefined,
				description: formData.description || undefined,
				buttonLabel: formData.buttonLabel || undefined,
				imageUrl: formData.imageUrl || undefined,
				thumbnailUrl: formData.thumbnailUrl || undefined,
				color: hexToColor(formData.color) ?? undefined,
			},
		};
	};

	const validateForm = (): CreateAutomoderatorReportPromptBody | undefined => {
		if (mode === 'raw' && formData.promptRaw && !isValidJSON(formData.promptRaw)) {
			setErrors({ promptRaw: 'Must be valid JSON' });
			setGeneralError(null);
			return undefined;
		}

		// Checked here rather than left to the schema: `buildBody` can only send a number or nothing, so an
		// unparseable hex would reach the API as an omitted field and quietly post the default instead.
		const colorError = mode === 'normal' ? validateColorInput(formData.color) : null;
		if (colorError) {
			setErrors({ color: colorError });
			setGeneralError(null);
			return undefined;
		}

		const schema = mode === 'raw' ? createReportPromptWithRawContentSchema : createReportPromptWithRegularContentSchema;
		const result = schema.safeParse(buildBody());

		if (!result.success) {
			const next: FormErrors = {};
			for (const issue of result.error.issues) {
				const [first, second] = issue.path;
				if (first === 'channelId') {
					next.channelId ??= issue.message;
				} else if (first === 'prompt_raw') {
					next.promptRaw ??= issue.message;
				} else if (first === 'prompt' && typeof second === 'string') {
					next[second as keyof FormData] ??= issue.message;
				}
			}

			setErrors(next);
			setGeneralError(null);
			return undefined;
		}

		setErrors({});
		return result.data as CreateAutomoderatorReportPromptBody;
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		const body = validateForm();
		if (!body) {
			return;
		}

		setGeneralError(null);

		try {
			if (existing) {
				// The channel is not part of an update -- see the route's own note on why moving a prompt is
				// delete-and-recreate.
				const { channelId: _channelId, ...rest } = body;
				await updatePrompt.mutateAsync(rest);
			} else {
				await createPrompt.mutateAsync(body);
			}

			router.replace(`/dashboard/${guildId}/automoderator/report-prompts`);
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 422) {
				setGeneralError('Invalid prompt data. Please check your JSON and try again.');
				return;
			}

			setGeneralError(error instanceof APIError ? error.message : 'An unknown error occurred. Please try again later.');
		}
	};

	if (guildInfoError && guildInfo === undefined) {
		return <UserErrorHandler error={guildInfoError} />;
	}

	if (isLoading) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-32 w-full" />
			</div>
		);
	}

	const isSubmitting = createPrompt.isPending || updatePrompt.isPending;

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			{generalError && <p className="text-sm text-misc-danger">{generalError}</p>}

			{existing ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Posted in{' '}
					<span className="text-primary dark:text-primary-dark">
						#{guildInfo!.channels.find((channel) => channel.id === existing.channelId)?.name ?? existing.channelId}
					</span>
					. To move it, delete this prompt and post a new one.
				</p>
			) : (
				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.channelId}
					label="Channel"
					onChange={(value) => updateFormData('channelId', value ?? '')}
					placeholder="Select the channel to post the prompt in"
					required
					selectedId="channelId"
					value={formData.channelId}
				/>
			)}

			<div className="flex gap-2">
				{(['normal', 'raw'] as const).map((option) => (
					<button
						className={
							mode === option
								? 'rounded-md bg-misc-accent px-3 py-1.5 text-sm text-accent'
								: 'rounded-md bg-on-tertiary px-3 py-1.5 text-sm text-primary dark:bg-on-tertiary-dark dark:text-primary-dark'
						}
						key={option}
						onClick={() => setMode(option)}
						type="button"
					>
						{option === 'normal' ? 'Guided' : 'Raw JSON'}
					</button>
				))}
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				{mode === 'normal' ? (
					<div className="space-y-4">
						<TextField
							error={errors.title}
							id="prompt-title"
							label="Title"
							onChange={(value) => updateFormData('title', value)}
							value={formData.title}
						/>
						<TextAreaField
							error={errors.description}
							id="prompt-description"
							label="Description"
							maxLength={4_000}
							onChange={(value) => updateFormData('description', value)}
							rows={12}
							value={formData.description}
						/>
						<TextField
							error={errors.buttonLabel}
							id="prompt-button-label"
							label="Button label"
							onChange={(value) => updateFormData('buttonLabel', value)}
							value={formData.buttonLabel}
						/>
						<TextField
							error={errors.imageUrl}
							id="prompt-image-url"
							label="Image URL"
							onChange={(value) => updateFormData('imageUrl', value)}
							value={formData.imageUrl}
						/>
						<TextField
							error={errors.thumbnailUrl}
							id="prompt-thumbnail-url"
							label="Thumbnail URL"
							onChange={(value) => updateFormData('thumbnailUrl', value)}
							value={formData.thumbnailUrl}
						/>
						<ColorField
							error={errors.color}
							id="prompt-color"
							label="Color"
							onChange={(value) => updateFormData('color', value)}
							value={formData.color}
						/>
					</div>
				) : (
					<RawJsonField
						error={errors.promptRaw}
						id="promptRaw"
						label="Raw JSON prompt message"
						onFormatClick={() => {
							try {
								updateFormData('promptRaw', JSON.stringify(JSON.parse(formData.promptRaw), null, 2));
							} catch {
								// Invalid JSON, ignore -- the submit path reports it.
							}
						}}
						onPaste={(event) => {
							// Pasting a message payload copied out of Discord's own tooling arrives minified; reformatting it
							// on the way in is the difference between an editable block and a single unreadable line.
							const pasted = event.clipboardData.getData('text');
							try {
								const formatted = JSON.stringify(JSON.parse(pasted), null, 2);
								event.preventDefault();
								updateFormData('promptRaw', formatted);
							} catch {
								// Not JSON -- let the default paste happen.
							}
						}}
						onValueChange={(value) => updateFormData('promptRaw', value)}
						value={formData.promptRaw}
					/>
				)}

				{/* The install button is appended server-side either way, so the preview always renders one -- a
			    preview that omitted it would understate what gets posted. */}
				{mode === 'normal' ? (
					<EmbedMessagePreview
						buttonLabel={formData.buttonLabel}
						color={formData.color}
						defaultButtonLabel={REPORT_PROMPT_DEFAULT_BUTTON_LABEL}
						description={formData.description}
						forBot="AUTOMODERATOR"
						heading="Prompt preview"
						imageUrl={formData.imageUrl}
						mode="normal"
						thumbnailUrl={formData.thumbnailUrl}
						title={formData.title}
					/>
				) : (
					<EmbedMessagePreview
						defaultButtonLabel={REPORT_PROMPT_DEFAULT_BUTTON_LABEL}
						forBot="AUTOMODERATOR"
						heading="Prompt preview"
						mode="raw"
						raw={formData.promptRaw}
					/>
				)}
			</div>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				The install button is added automatically and always points at this bot&apos;s user-install page — a prompt
				without it would lead nowhere, so it cannot be removed, even in raw mode.
			</p>

			<FormActions
				isSubmitting={isSubmitting}
				onCancel={() => router.back()}
				pendingLabel={existing ? 'Saving…' : 'Posting…'}
				submitLabel={existing ? 'Save changes' : 'Post prompt'}
			/>
		</form>
	);
}
