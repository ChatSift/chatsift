'use client';

import { updateSnippetBodySchema } from '@chatsift/api/modmail-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { SnippetFormData, SnippetFormErrors } from '../../_components/snippetForm';
import { mapSnippetApiError, mapSnippetIssues } from '../../_components/snippetForm';
import type { ModmailSnippet, UpdateModmailSnippetBody } from '@/api/routes/modmail';
import { useModmailSnippets, useUpdateModmailSnippet } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { Skeleton } from '@/components/common/Skeleton';
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
						type="text"
						value={form.name}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Will be usable as <span className="font-mono">/{normalizeSnippetName(form.name) || '...'}</span>
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
						Optional. Shown as an image on every reply this snippet sends -- must be a direct link to an image. Clear to
						remove it.
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
					isDisabled={updateSnippet.isPending}
					type="submit"
				>
					{updateSnippet.isPending ? 'Saving...' : 'Save Changes'}
				</Button>
				<Button
					className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
					onPress={() => router.back()}
					type="button"
				>
					Back
				</Button>
			</div>
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
