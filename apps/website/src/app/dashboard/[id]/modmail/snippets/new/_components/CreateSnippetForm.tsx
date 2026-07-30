'use client';

import { createSnippetBodySchema } from '@chatsift/api/modmail-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SnippetFormData, SnippetFormErrors } from '../../_components/snippetForm';
import { mapSnippetApiError, mapSnippetIssues } from '../../_components/snippetForm';
import type { CreateModmailSnippetBody } from '@/api/routes/modmail';
import { useCreateModmailSnippet } from '@/api/routes/modmail';
import { FormActions } from '@/components/common/FormActions';
import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';
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

				<TextField
					error={errors.name}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Will be usable as <span className="font-mono">/{previewName || '...'}</span>
						</p>
					}
					id="snippet-name"
					label="Name *"
					maxLength={32}
					onBlur={normalizeName}
					onChange={(value) => updateField('name', value)}
					placeholder="reportuser"
					value={form.name}
				/>

				<TextAreaField
					error={errors.content}
					id="snippet-content"
					label="Content *"
					maxLength={2_000}
					onChange={(value) => updateField('content', value)}
					rows={4}
					value={form.content}
				/>

				<TextField
					error={errors.attachmentUrl}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Optional. Shown as an image on every reply this snippet sends -- must be a direct link to an image.
						</p>
					}
					id="snippet-attachment-url"
					label="Attachment URL"
					onChange={(value) => updateField('attachmentUrl', value)}
					placeholder="https://..."
					type="url"
					value={form.attachmentUrl}
				/>

				<TextField
					error={errors.attachmentFilename}
					id="snippet-attachment-filename"
					label="Attachment filename"
					maxLength={256}
					onChange={(value) => updateField('attachmentFilename', value)}
					placeholder="screenshot.png"
					value={form.attachmentFilename}
				/>
			</div>

			<FormActions
				isSubmitDisabled={!form.name.trim() || !form.content.trim()}
				isSubmitting={createSnippet.isPending}
				onCancel={() => router.back()}
				pendingLabel="Creating..."
				submitLabel="Add Snippet"
			/>
		</form>
	);
}
