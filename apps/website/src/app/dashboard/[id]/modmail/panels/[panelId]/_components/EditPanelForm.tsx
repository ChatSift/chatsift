'use client';

import { updatePanelBodySchema } from '@chatsift/api/modmail-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CategoryCheckboxList } from '../../_components/CategoryCheckboxList';
import { PanelEmbedFields } from '../../_components/PanelEmbedFields';
import { PanelModeToggle } from '../../_components/PanelModeToggle';
import { PanelPreview } from '../../_components/PanelPreview';
import { APIError } from '@/api/error';
import type { ModmailPanel, UpdateModmailPanelBody } from '@/api/routes/modmail';
import { useModmailPanels, useUpdateModmailPanel } from '@/api/routes/modmail';
import { colorToHex, hexToColor, validateColorInput } from '@/components/common/ColorField';
import { FormActions } from '@/components/common/FormActions';
import { RawJsonField } from '@/components/common/RawJsonField';
import { Skeleton } from '@/components/common/Skeleton';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

interface FormData {
	attachmentUrl: string;
	buttonLabel: string;
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
		'attachmentUrl' | 'buttonLabel' | 'categoryIds' | 'color' | 'description' | 'panelRaw' | 'thumbnailUrl' | 'title',
		string
	>
>;

/**
 * The keys under `panel` in the request body that map one-to-one onto a form field of the same name --
 * everything the schema can complain about that has somewhere to render the complaint.
 */
const PANEL_EMBED_FIELDS = ['title', 'description', 'buttonLabel', 'attachmentUrl', 'thumbnailUrl', 'color'] as const;

function mapIssuesToFormErrors(issues: readonly { message: string; path: PropertyKey[] }[]): FormErrors {
	const errors: FormErrors = {};

	for (const issue of issues) {
		const [first, second] = issue.path;

		if (first === 'categoryIds') {
			errors.categoryIds ??= issue.message;
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

function isValidJSON(value: string): boolean {
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}

// `panel.panelJsonData` is always written by our own `JSON.stringify` server-side, but pretty-printing it here
// still shouldn't be allowed to crash the form on mount if a row ever ends up with something unexpected (a bad
// migration, a direct DB edit, etc.) -- falls back to the raw stored string un-formatted so there's still
// something editable in the raw-JSON textarea instead of a blank page.
function prettyPrintOrRaw(value: string): string {
	try {
		return JSON.stringify(JSON.parse(value), null, 2);
	} catch {
		return value;
	}
}

// Best-effort: a panel authored in "normal" mode stores exactly `{ embeds: [{ color, title, description }] }`, so
// title/description round-trip cleanly into the normal-mode fields. A panel authored in raw mode (or edited raw
// since) can be an arbitrary Discord message payload, so this only ever pre-fills what it can recognize -- it
// never fails, it just leaves fields blank for shapes it doesn't understand. Note there's no `buttonLabel` in
// here at all: the button's current label lives only in the live Discord component, not in `panelJsonData`, so it
// can't be recovered -- leaving it blank on submit resets it to the schema's 'Create Ticket' default.
type NormalFields = Pick<FormData, 'attachmentUrl' | 'color' | 'description' | 'thumbnailUrl' | 'title'>;

const BLANK_NORMAL_FIELDS: NormalFields = {
	title: '',
	description: '',
	attachmentUrl: '',
	thumbnailUrl: '',
	color: '',
};

function embedMediaUrl(value: unknown): string {
	if (typeof value !== 'object' || value === null) {
		return '';
	}

	const url = (value as Record<string, unknown>)['url'];
	return typeof url === 'string' ? url : '';
}

function bestEffortNormalFields(panelJsonData: string): NormalFields {
	try {
		const parsed = JSON.parse(panelJsonData) as Record<string, unknown>;
		const embeds = parsed['embeds'];
		if (Array.isArray(embeds) && embeds.length > 0 && typeof embeds[0] === 'object' && embeds[0] !== null) {
			const embed = embeds[0] as Record<string, unknown>;

			return {
				title: typeof embed['title'] === 'string' ? embed['title'] : '',
				description: typeof embed['description'] === 'string' ? embed['description'] : '',
				attachmentUrl: embedMediaUrl(embed['image']),
				thumbnailUrl: embedMediaUrl(embed['thumbnail']),
				// Pre-filled even when it's the default -- a panel authored before colors were configurable
				// stored the default explicitly, and blanking the field would misrepresent it as "unset" while
				// still resolving to the same color. `colorToHex` is safe for any stored number; out-of-range
				// values (only reachable via raw mode) are what the `ColorField` hex check rejects on submit.
				color: typeof embed['color'] === 'number' ? colorToHex(embed['color']) : '',
			};
		}
	} catch {
		// Not JSON, or not the expected shape -- fall through to blank fields.
	}

	return BLANK_NORMAL_FIELDS;
}

interface EditPanelFormProps {
	readonly panel: ModmailPanel;
}

export function EditPanelForm({ panel }: EditPanelFormProps) {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const { id: guildId } = params;

	const updatePanel = useUpdateModmailPanel(guildId, panel.id);

	const [mode, setMode] = useState<'normal' | 'raw'>('raw');
	const [formData, setFormData] = useState<FormData>(() => ({
		...bestEffortNormalFields(panel.panelJsonData),
		buttonLabel: '',
		panelRaw: prettyPrintOrRaw(panel.panelJsonData),
	}));
	const [categoryIds, setCategoryIds] = useState<number[]>(panel.categoryIds);
	const [errors, setErrors] = useState<FormErrors>({});
	const [generalError, setGeneralError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const updateFormData = (field: keyof FormData, value: string) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const buildBody = (): Record<string, unknown> => {
		const base = { categoryIds };

		if (mode === 'raw') {
			return { ...base, panel_raw: formData.panelRaw ? JSON.parse(formData.panelRaw) : {} };
		}

		return {
			...base,
			panel: {
				// Empty means "no title", not an empty title (#397) -- the schema refuses an empty string, and
				// an embed with neither a title nor a description is what Discord rejects outright.
				title: formData.title || undefined,
				description: formData.description || undefined,
				buttonLabel: formData.buttonLabel || undefined,
				attachmentUrl: formData.attachmentUrl || undefined,
				thumbnailUrl: formData.thumbnailUrl || undefined,
				color: hexToColor(formData.color) ?? undefined,
			},
		};
	};

	const validateForm = (): UpdateModmailPanelBody | undefined => {
		if (mode === 'raw' && formData.panelRaw && !isValidJSON(formData.panelRaw)) {
			setErrors({ panelRaw: 'Must be valid JSON' });
			setGeneralError(null);
			return undefined;
		}

		// Checked here rather than left to the schema: `buildBody` can only send a number or nothing, so an
		// unparseable hex would reach the API as an omitted field and post the default instead of failing.
		const colorError = mode === 'normal' ? validateColorInput(formData.color) : null;
		if (colorError) {
			setErrors({ color: colorError });
			setGeneralError(null);
			return undefined;
		}

		const data = buildBody();
		const result = updatePanelBodySchema.safeParse(data);

		if (!result.success) {
			setErrors(mapIssuesToFormErrors(result.error.issues));
			setGeneralError(null);
			return undefined;
		}

		setErrors({});
		return result.data as UpdateModmailPanelBody;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const body = validateForm();
		if (!body) {
			return;
		}

		setGeneralError(null);
		setSuccessMessage(null);

		try {
			await updatePanel.mutateAsync(body);
			setSuccessMessage('Panel updated.');
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 422) {
				setGeneralError(error.message || 'Invalid panel data. Please check your JSON data and try again.');
				return;
			}

			if (error instanceof APIError && error.statusCode === 400) {
				const panelField = mode === 'raw' ? 'panel_raw' : 'panel';
				const candidates: [keyof FormErrors, string | undefined][] = [
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
			console.error('Failed to update ticket panel:', error);
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

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			{generalError && <p className="mt-1 text-sm text-misc-danger">{generalError}</p>}
			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent"
					role="status"
				>
					{successMessage}
				</p>
			)}

			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Categories</h2>
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
				{mode === 'normal' && (
					<p className="text-sm text-secondary dark:text-secondary-dark">
						Leave the button label blank to reset it to the default (&quot;Create Ticket&quot;) -- the current label
						can&apos;t be recovered for pre-fill.
					</p>
				)}

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
				cancelLabel="Back"
				isSubmitting={updatePanel.isPending}
				onCancel={() => router.back()}
				pendingLabel="Saving..."
				submitLabel="Save Changes"
			/>
		</form>
	);
}

export function EditPanelFormLoader() {
	const params = useParams<{ id: string; panelId: string }>();
	const { data: panels, isLoading, error } = useModmailPanels(params.id);

	if (error && panels === undefined) {
		return <UserErrorHandler error={error} />;
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

	const panel = panels!.find((candidate) => String(candidate.id) === params.panelId);
	if (!panel) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Ticket panel not found</p>
			</div>
		);
	}

	return <EditPanelForm panel={panel} />;
}
