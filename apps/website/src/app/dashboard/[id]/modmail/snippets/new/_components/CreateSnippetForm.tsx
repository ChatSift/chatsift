'use client';

import { createSnippetBodySchema } from '@chatsift/api/modmail-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SnippetFormData, SnippetFormErrors } from '../../_components/snippetForm';
import { mapSnippetApiError, mapSnippetIssues } from '../../_components/snippetForm';
import type { CreateModmailSnippetBody } from '@/api/routes/modmail';
import { useCreateModmailSnippet } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { normalizeSnippetName } from '@/utils/snippetName';

const EMPTY_FORM: SnippetFormData = { name: '', content: '', attachmentUrl: '', attachmentFilename: '' };

export function CreateSnippetForm() {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<SnippetFormData>(EMPTY_FORM);
	const [errors, setErrors] = useState<SnippetFormErrors>({});
	const createSnippet = useCreateModmailSnippet(guildId);

	const updateField = (field: keyof SnippetFormData, value: string) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	// Snippet names double as the Discord slash command Discord registers for them, which is a much stricter
	// format than a free-text field -- normalizing on blur (rather than fighting the user keystroke-by-keystroke)
	// plus the live preview below the field is meant to make that format obvious instead of surprising on submit.
	const normalizeName = () => updateField('name', normalizeSnippetName(form.name));

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const attachmentUrl = form.attachmentUrl.trim();
		const attachmentFilename = form.attachmentFilename.trim();

		const data: CreateModmailSnippetBody = {
			name: normalizeSnippetName(form.name),
			content: form.content.trim(),
			...(attachmentUrl && { attachmentUrl }),
			// A filename without a URL is meaningless (there's nothing to attach it to) and the API schema
			// rejects it outright -- only send it alongside an actual URL.
			...(attachmentUrl && attachmentFilename && { attachmentFilename }),
		};

		const result = createSnippetBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapSnippetIssues(result.error.issues));
			return;
		}

		try {
			await createSnippet.mutateAsync(result.data);
			router.replace(`/dashboard/${guildId}/modmail/snippets`);
		} catch (error) {
			setErrors(mapSnippetApiError(error, 'create'));
		}
	};

	const previewName = normalizeSnippetName(form.name);

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Snippet Details</h2>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="snippet-name"
					>
						Name *
					</label>
					<input
						aria-describedby={errors.name ? 'snippet-name-error' : undefined}
						aria-invalid={Boolean(errors.name)}
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="snippet-name"
						maxLength={32}
						onBlur={normalizeName}
						onChange={(e) => updateField('name', e.target.value)}
						placeholder="reportuser"
						type="text"
						value={form.name}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Will be usable as <span className="font-mono">/{previewName || '...'}</span>
					</p>
					{errors.name && (
						<p className="mt-1 text-sm text-misc-danger" id="snippet-name-error">
							{errors.name}
						</p>
					)}
				</div>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="snippet-content"
					>
						Content *
					</label>
					<textarea
						aria-describedby={errors.content ? 'snippet-content-error' : undefined}
						aria-invalid={Boolean(errors.content)}
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="snippet-content"
						maxLength={2_000}
						onChange={(e) => updateField('content', e.target.value)}
						rows={4}
						value={form.content}
					/>
					{errors.content && (
						<p className="mt-1 text-sm text-misc-danger" id="snippet-content-error">
							{errors.content}
						</p>
					)}
				</div>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="snippet-attachment-url"
					>
						Attachment URL
					</label>
					<input
						aria-describedby={errors.attachmentUrl ? 'snippet-attachment-url-error' : undefined}
						aria-invalid={Boolean(errors.attachmentUrl)}
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="snippet-attachment-url"
						onChange={(e) => updateField('attachmentUrl', e.target.value)}
						placeholder="https://..."
						type="url"
						value={form.attachmentUrl}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Optional. Shown as an image on every reply this snippet sends -- must be a direct link to an image.
					</p>
					{errors.attachmentUrl && (
						<p className="mt-1 text-sm text-misc-danger" id="snippet-attachment-url-error">
							{errors.attachmentUrl}
						</p>
					)}
				</div>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="snippet-attachment-filename"
					>
						Attachment filename
					</label>
					<input
						aria-describedby={errors.attachmentFilename ? 'snippet-attachment-filename-error' : undefined}
						aria-invalid={Boolean(errors.attachmentFilename)}
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="snippet-attachment-filename"
						maxLength={256}
						onChange={(e) => updateField('attachmentFilename', e.target.value)}
						placeholder="screenshot.png"
						type="text"
						value={form.attachmentFilename}
					/>
					{errors.attachmentFilename && (
						<p className="mt-1 text-sm text-misc-danger" id="snippet-attachment-filename-error">
							{errors.attachmentFilename}
						</p>
					)}
				</div>
			</div>

			<div className="flex gap-4">
				<Button
					className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
					isDisabled={!form.name.trim() || !form.content.trim() || createSnippet.isPending}
					type="submit"
				>
					{createSnippet.isPending ? 'Creating...' : 'Add Snippet'}
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
