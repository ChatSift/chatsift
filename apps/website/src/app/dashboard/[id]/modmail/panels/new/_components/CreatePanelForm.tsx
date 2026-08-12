'use client';

import { createPanelWithRawContentSchema, createPanelWithRegularContentSchema } from '@chatsift/api/modmail-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CategoryCheckboxList } from '../../_components/CategoryCheckboxList';
import { PanelEmbedFields } from '../../_components/PanelEmbedFields';
import { PanelModeToggle } from '../../_components/PanelModeToggle';
import { PanelPreview } from '../../_components/PanelPreview';
import { APIError } from '@/api/error';
import { useGuildInfo } from '@/api/routes/guilds';
import type { CreateModmailPanelBody } from '@/api/routes/modmail';
import { useCreateModmailPanel } from '@/api/routes/modmail';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { hexToColor } from '@/components/common/ColorField';
import { FormActions } from '@/components/common/FormActions';
import { RawJsonField } from '@/components/common/RawJsonField';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface FormData {
	attachmentUrl: string;
	buttonLabel: string;
	channelId: string;
	/**
	 * `#rrggbb`, or empty for "use the default" -- see `ColorField`.
	 */
	color: string;
	description: string;
	panelRaw: string;
	thumbnailUrl: string;
	title: string;
}

type FormErrors = Partial<
	Record<
		| 'attachmentUrl'
		| 'buttonLabel'
		| 'categoryIds'
		| 'channelId'
		| 'color'
		| 'description'
		| 'panelRaw'
		| 'thumbnailUrl'
		| 'title',
		string
	>
>;

const TOP_LEVEL_FIELDS = ['channelId', 'categoryIds'] as const;

/**
 * The keys under `panel` in the request body that map one-to-one onto a form field of the same name --
 * everything the schema can complain about that has somewhere to render the complaint.
 */
const PANEL_EMBED_FIELDS = ['title', 'description', 'buttonLabel', 'attachmentUrl', 'thumbnailUrl', 'color'] as const;

function mapIssuesToFormErrors(issues: readonly { message: string; path: PropertyKey[] }[]): FormErrors {
	const errors: FormErrors = {};

	for (const issue of issues) {
		const [first, second] = issue.path;

		if (typeof first === 'string' && (TOP_LEVEL_FIELDS as readonly string[]).includes(first)) {
			errors[first as 'categoryIds' | 'channelId'] ??= issue.message;
		} else if (first === 'panel' && typeof second === 'string') {
			if (PANEL_EMBED_FIELDS.includes(second as (typeof PANEL_EMBED_FIELDS)[number])) {
				errors[second as (typeof PANEL_EMBED_FIELDS)[number]] ??= issue.message;
			}
		} else if (first === 'panel_raw') {
			errors.panelRaw ??= issue.message;
		}
	}

	return errors;
}

const allowedChannelTypes = [ChannelType.GuildText, ...threadTypes];

function isValidJSON(value: string): boolean {
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}

export function CreatePanelForm() {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const { id: guildId } = params;

	const { data: guildInfo, isLoading, error: guildInfoError } = useGuildInfo(guildId, 'MODMAIL');
	const createPanel = useCreateModmailPanel(guildId);

	const [mode, setMode] = useState<'normal' | 'raw'>('normal');
	const [formData, setFormData] = useState<FormData>({
		channelId: '',
		title: '',
		description: '',
		buttonLabel: '',
		attachmentUrl: '',
		thumbnailUrl: '',
		color: '',
		panelRaw: '',
	});
	const [categoryIds, setCategoryIds] = useState<number[]>([]);
	const [errors, setErrors] = useState<FormErrors>({});
	const [generalError, setGeneralError] = useState<string | null>(null);

	const updateFormData = (field: keyof FormData, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const buildBody = (): Record<string, unknown> => {
		const base = { channelId: formData.channelId, categoryIds };

		if (mode === 'raw') {
			return { ...base, panel_raw: formData.panelRaw ? JSON.parse(formData.panelRaw) : {} };
		}

		return {
			...base,
			panel: {
				title: formData.title,
				description: formData.description || undefined,
				buttonLabel: formData.buttonLabel || undefined,
				attachmentUrl: formData.attachmentUrl || undefined,
				thumbnailUrl: formData.thumbnailUrl || undefined,
				color: hexToColor(formData.color) ?? undefined,
			},
		};
	};

	const validateForm = (): CreateModmailPanelBody | undefined => {
		if (mode === 'raw' && formData.panelRaw && !isValidJSON(formData.panelRaw)) {
			setErrors({ panelRaw: 'Must be valid JSON' });
			setGeneralError(null);
			return undefined;
		}

		const data = buildBody();
		const schema = mode === 'raw' ? createPanelWithRawContentSchema : createPanelWithRegularContentSchema;
		const result = schema.safeParse(data);

		if (!result.success) {
			setErrors(mapIssuesToFormErrors(result.error.issues));
			setGeneralError(null);
			return undefined;
		}

		setErrors({});
		return result.data as CreateModmailPanelBody;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const body = validateForm();
		if (!body) {
			return;
		}

		setGeneralError(null);

		try {
			await createPanel.mutateAsync(body);
			router.replace(`/dashboard/${guildId}/modmail/panels`);
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 422) {
				setGeneralError('Invalid panel data. Please check your JSON data and try again.');
				return;
			}

			if (error instanceof APIError && error.statusCode === 400) {
				const panelField = mode === 'raw' ? 'panel_raw' : 'panel';
				const candidates: [keyof FormErrors, string | undefined][] = [
					['channelId', error.fieldError('channelId')],
					['categoryIds', error.fieldError('categoryIds')],
					['title', error.fieldError(panelField, 'title')],
					['description', error.fieldError(panelField, 'description')],
					['buttonLabel', error.fieldError(panelField, 'buttonLabel')],
					['attachmentUrl', error.fieldError(panelField, 'attachmentUrl')],
					['thumbnailUrl', error.fieldError(panelField, 'thumbnailUrl')],
					['color', error.fieldError(panelField, 'color')],
				];

				const newErrors: FormErrors = Object.fromEntries(
					candidates.filter((entry): entry is [keyof FormErrors, string] => entry[1] !== undefined),
				);

				setErrors(newErrors);
				setGeneralError(Object.keys(newErrors).length > 0 ? null : error.message);
				return;
			}

			setGeneralError(error instanceof APIError ? error.message : 'An unknown error occurred. Please try again later.');
			console.error('Failed to create ticket panel:', error);
		}
	};

	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const pastedText = e.clipboardData.getData('text');

		try {
			const parsed = JSON.parse(pastedText);
			const formatted = JSON.stringify(parsed, null, 2);

			e.preventDefault();
			updateFormData('panelRaw', formatted);
		} catch {
			// Not valid JSON, let default paste happen
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

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			{generalError && <p className="mt-1 text-sm text-misc-danger">{generalError}</p>}

			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Panel Details</h2>

				<ChannelSelect
					allowedTypes={allowedChannelTypes}
					channels={guildInfo!.channels}
					error={errors.channelId}
					label="Channel"
					onChange={(value) => updateFormData('channelId', value ?? '')}
					placeholder="Select the channel to post the panel in"
					required
					selectedId="channelId"
					value={formData.channelId}
				/>

				<CategoryCheckboxList
					error={errors.categoryIds}
					guildId={guildId}
					onChange={setCategoryIds}
					value={categoryIds}
				/>
			</div>

			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Panel Message</h2>

				<PanelModeToggle mode={mode} onModeChange={setMode} />

				<div className="grid gap-6 lg:grid-cols-2">
					<div>
						{mode === 'normal' ? (
							<PanelEmbedFields
								attachmentUrl={formData.attachmentUrl}
								buttonLabel={formData.buttonLabel}
								color={formData.color}
								description={formData.description}
								errors={errors}
								onAttachmentUrlChange={(value) => updateFormData('attachmentUrl', value)}
								onButtonLabelChange={(value) => updateFormData('buttonLabel', value)}
								onColorChange={(value) => updateFormData('color', value)}
								onDescriptionChange={(value) => updateFormData('description', value)}
								onThumbnailUrlChange={(value) => updateFormData('thumbnailUrl', value)}
								onTitleChange={(value) => updateFormData('title', value)}
								thumbnailUrl={formData.thumbnailUrl}
								title={formData.title}
							/>
						) : (
							<RawJsonField
								error={errors.panelRaw}
								id="panelRaw"
								label="Raw JSON Panel Message"
								onFormatClick={() => {
									try {
										const parsed = JSON.parse(formData.panelRaw);
										updateFormData('panelRaw', JSON.stringify(parsed, null, 2));
									} catch {
										// Invalid JSON, ignore
									}
								}}
								onPaste={handlePaste}
								onValueChange={(value) => updateFormData('panelRaw', value)}
								value={formData.panelRaw}
							/>
						)}
					</div>

					{mode === 'normal' ? (
						<PanelPreview
							attachmentUrl={formData.attachmentUrl}
							buttonLabel={formData.buttonLabel}
							color={formData.color}
							description={formData.description}
							mode="normal"
							thumbnailUrl={formData.thumbnailUrl}
							title={formData.title}
						/>
					) : (
						<PanelPreview mode="raw" raw={formData.panelRaw} />
					)}
				</div>
			</div>

			<FormActions
				isSubmitting={createPanel.isPending}
				onCancel={() => router.back()}
				pendingLabel="Creating..."
				submitLabel="Create Panel"
			/>
		</form>
	);
}
