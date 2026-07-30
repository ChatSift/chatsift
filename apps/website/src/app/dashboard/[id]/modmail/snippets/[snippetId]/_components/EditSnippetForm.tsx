'use client';

import { updateSnippetBodySchema } from '@chatsift/api/modmail-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SnippetFormData, SnippetFormErrors } from '../../_components/snippetForm';
import { mapSnippetApiError, mapSnippetIssues } from '../../_components/snippetForm';
import type { ModmailSnippet, UpdateModmailSnippetBody } from '@/api/routes/modmail';
import { useModmailSnippets, useUpdateModmailSnippet } from '@/api/routes/modmail';
import { FormActions } from '@/components/common/FormActions';
import { Skeleton } from '@/components/common/Skeleton';
import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { normalizeSnippetName } from '@/utils/snippetName';

function formFromSnippet(snippet: ModmailSnippet): SnippetFormData {
	return {
		name: snippet.name,
		content: snippet.content,
		attachmentUrl: snippet.attachmentUrl ?? '',
		attachmentFilename: snippet.attachmentFilename ?? '',
	};
}

interface EditSnippetFormProps {
	readonly snippet: ModmailSnippet;
}

export function EditSnippetForm({ snippet }: EditSnippetFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<SnippetFormData>(() => formFromSnippet(snippet));
	const [errors, setErrors] = useState<SnippetFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const updateSnippet = useUpdateModmailSnippet(guildId, snippet.id);

	const updateField = (field: keyof SnippetFormData, value: string) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const normalizeName = () => updateField('name', normalizeSnippetName(form.name));

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const attachmentUrl = form.attachmentUrl.trim() || null;

		const data: UpdateModmailSnippetBody = {
			name: normalizeSnippetName(form.name),
			content: form.content.trim(),
			attachmentUrl,
			// A filename without a URL is meaningless and the API schema rejects it outright -- clearing the
			// URL always clears the filename along with it, regardless of what's still typed in that field.
			attachmentFilename: attachmentUrl ? form.attachmentFilename.trim() || null : null,
		};

		const result = updateSnippetBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapSnippetIssues(result.error.issues));
			setSuccessMessage(null);
			return;
		}

		setSuccessMessage(null);

		try {
			await updateSnippet.mutateAsync(result.data as UpdateModmailSnippetBody);
			setErrors({});
			setSuccessMessage('Snippet updated.');
		} catch (error) {
			setErrors(mapSnippetApiError(error, 'update'));
		}
	};

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent"
					role="status"
				>
					{successMessage}
				</p>
			)}

			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Snippet Details</h2>

				<TextField
					error={errors.name}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Will be usable as <span className="font-mono">/{normalizeSnippetName(form.name) || '...'}</span>
						</p>
					}
					id="snippet-name"
					label="Name *"
					maxLength={32}
					onBlur={normalizeName}
					onChange={(value) => updateField('name', value)}
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
							Optional. Shown as an image on every reply this snippet sends -- must be a direct link to an image. Clear
							to remove it.
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
				cancelLabel="Back"
				isSubmitting={updateSnippet.isPending}
				onCancel={() => router.back()}
				pendingLabel="Saving..."
				submitLabel="Save Changes"
			/>
		</form>
	);
}

export function EditSnippetFormLoader() {
	const params = useParams<{ id: string; snippetId: string }>();
	const { data: snippets, isLoading, error } = useModmailSnippets(params.id);

	if (error && snippets === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !snippets) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-32 w-full" />
			</div>
		);
	}

	const snippet = snippets.find((candidate) => String(candidate.id) === params.snippetId);
	if (!snippet) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Snippet not found</p>
			</div>
		);
	}

	return <EditSnippetForm snippet={snippet} />;
}
