'use client';

import { updateSnippetBodySchema } from '@chatsift/api/modmail-schemas';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { useGrantAuth } from '@/api/grant';
import type { ModmailSnippet, UpdateModmailSnippetBody } from '@/api/routes/modmail';
import { useDeleteModmailSnippet, useUpdateModmailSnippet } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { normalizeSnippetName } from '@/utils/snippetName';
import { formatDate } from '@/utils/util';

interface SnippetFormData {
	attachmentFilename: string;
	attachmentUrl: string;
	content: string;
	name: string;
}

type SnippetFormErrors = Partial<Record<keyof SnippetFormData, string>>;

const SNIPPET_FIELDS = [
	'name',
	'content',
	'attachmentUrl',
	'attachmentFilename',
] as const satisfies (keyof SnippetFormData)[];

function mapSnippetIssues(issues: readonly { message: string; path: PropertyKey[] }[]): SnippetFormErrors {
	const errors: SnippetFormErrors = {};

	for (const issue of issues) {
		const [first] = issue.path;
		if (typeof first === 'string' && (SNIPPET_FIELDS as readonly string[]).includes(first)) {
			errors[first as keyof SnippetFormData] ??= issue.message;
		}
	}

	return errors;
}

function formFromSnippet(snippet: ModmailSnippet): SnippetFormData {
	return {
		name: snippet.name,
		content: snippet.content,
		attachmentUrl: snippet.attachmentUrl ?? '',
		attachmentFilename: snippet.attachmentFilename ?? '',
	};
}

function isImageAttachment(snippet: Pick<ModmailSnippet, 'attachmentFilename' | 'attachmentUrl'>): boolean {
	const name = snippet.attachmentFilename ?? snippet.attachmentUrl ?? '';
	return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(name);
}

interface SnippetCardProps {
	readonly guildId: string;
	readonly snippet: ModmailSnippet;
}

export function SnippetCard({ guildId, snippet }: SnippetCardProps) {
	const grant = useGrantAuth();
	const [form, setForm] = useState<SnippetFormData | null>(null);
	const [errors, setErrors] = useState<SnippetFormErrors>({});
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
	// Rendering an `<img>` fetches it immediately on page load -- for a staff-pasted URL we haven't
	// vetted, that's an unprompted request to wherever they typed, made by every moderator who happens
	// to open this page. Gating it behind an explicit click means the preview only ever loads because
	// someone here chose to load it, same as clicking the link itself. Tracks *which* URL was approved
	// (not just a boolean) so editing the attachment to a different URL always requires a fresh click --
	// otherwise approval granted to the old URL would carry over and silently preview the new one too.
	const [previewedUrl, setPreviewedUrl] = useState<string | null>(null);
	const updateSnippet = useUpdateModmailSnippet(guildId, snippet.id);
	const deleteSnippet = useDeleteModmailSnippet(guildId);

	const editing = form !== null;

	const startEdit = () => {
		setForm(formFromSnippet(snippet));
		setErrors({});
	};

	const cancelEdit = () => {
		setForm(null);
		setErrors({});
	};

	const updateField = (field: keyof SnippetFormData, value: string) => {
		setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const normalizeName = () => {
		if (form) {
			updateField('name', normalizeSnippetName(form.name));
		}
	};

	const handleSave = async () => {
		if (!form) {
			return;
		}

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
			return;
		}

		try {
			await updateSnippet.mutateAsync(result.data as UpdateModmailSnippetBody);
			setForm(null);
			setErrors({});
		} catch (error) {
			if (error instanceof APIError) {
				if (error.statusCode === 409 || error.statusCode === 422) {
					setErrors({ name: error.message });
				} else if (error.statusCode === 400) {
					setErrors(
						Object.fromEntries(
							SNIPPET_FIELDS.map((field) => [field, error.fieldError(field)]).filter(([, message]) => message),
						),
					);
				} else {
					setErrors({ name: error.message || 'Failed to update snippet' });
				}

				return;
			}

			setErrors({ name: 'Failed to update snippet' });
			console.error('Failed to update snippet', error);
		}
	};

	const handleDelete = async () => {
		await deleteSnippet.mutateAsync(snippet.id);
		setShowConfirmDelete(false);
	};

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			{editing ? (
				<>
					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor={`snippet-name-${snippet.id}`}
						>
							Name *
						</label>
						<input
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`snippet-name-${snippet.id}`}
							maxLength={32}
							onBlur={normalizeName}
							onChange={(e) => updateField('name', e.target.value)}
							type="text"
							value={form.name}
						/>
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Will be usable as <span className="font-mono">/{normalizeSnippetName(form.name) || '...'}</span>
						</p>
						{errors.name && <p className="mt-1 text-sm text-misc-danger">{errors.name}</p>}
					</div>

					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor={`snippet-content-${snippet.id}`}
						>
							Content *
						</label>
						<textarea
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`snippet-content-${snippet.id}`}
							maxLength={2_000}
							onChange={(e) => updateField('content', e.target.value)}
							rows={4}
							value={form.content}
						/>
						{errors.content && <p className="mt-1 text-sm text-misc-danger">{errors.content}</p>}
					</div>

					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor={`snippet-attachment-url-${snippet.id}`}
						>
							Attachment URL
						</label>
						<input
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`snippet-attachment-url-${snippet.id}`}
							onChange={(e) => updateField('attachmentUrl', e.target.value)}
							placeholder="https://..."
							type="url"
							value={form.attachmentUrl}
						/>
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Optional. Shown as an image on every reply this snippet sends -- must be a direct link to an image. Clear
							to remove it.
						</p>
						{errors.attachmentUrl && <p className="mt-1 text-sm text-misc-danger">{errors.attachmentUrl}</p>}
					</div>

					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor={`snippet-attachment-filename-${snippet.id}`}
						>
							Attachment filename
						</label>
						<input
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`snippet-attachment-filename-${snippet.id}`}
							maxLength={256}
							onChange={(e) => updateField('attachmentFilename', e.target.value)}
							placeholder="screenshot.png"
							type="text"
							value={form.attachmentFilename}
						/>
						{errors.attachmentFilename && <p className="mt-1 text-sm text-misc-danger">{errors.attachmentFilename}</p>}
					</div>

					<div className="mt-auto flex justify-end gap-2">
						<Button onPress={handleSave}>Save</Button>
						<Button onPress={cancelEdit}>Cancel</Button>
					</div>
				</>
			) : (
				<>
					<p className="overflow-hidden overflow-ellipsis whitespace-nowrap font-mono text-lg font-semibold text-primary dark:text-primary-dark">
						/{snippet.name}
					</p>

					<p className="whitespace-pre-wrap text-sm text-primary dark:text-primary-dark">{snippet.content}</p>

					{snippet.attachmentUrl && (
						<div className="flex flex-col items-start gap-1">
							<a
								className="text-sm text-misc-accent underline"
								href={snippet.attachmentUrl}
								rel="noreferrer"
								target="_blank"
							>
								{snippet.attachmentFilename ?? snippet.attachmentUrl}
							</a>
							{isImageAttachment(snippet) &&
								(previewedUrl === snippet.attachmentUrl ? (
									// eslint-disable-next-line @next/next/no-img-element -- arbitrary staff-pasted external URL, not one of the app's known image sources Next's optimizer can proxy
									<img
										alt={snippet.attachmentFilename ?? 'snippet attachment'}
										className="max-h-40 rounded-md border border-on-secondary dark:border-on-secondary-dark"
										src={snippet.attachmentUrl}
									/>
								) : (
									<Button
										className="h-fit p-0 text-xs text-secondary underline hover:bg-transparent dark:text-secondary-dark"
										onPress={() => setPreviewedUrl(snippet.attachmentUrl)}
									>
										Show preview
									</Button>
								))}
						</div>
					)}

					<p className="text-xs text-secondary dark:text-secondary-dark">
						{snippet.timesUsed === 0
							? 'Never used'
							: `Used ${snippet.timesUsed} time${snippet.timesUsed === 1 ? '' : 's'}${
									snippet.lastUsedAt ? ` -- last used ${formatDate(new Date(snippet.lastUsedAt))}` : ''
								}`}
					</p>

					{/* A `/snippet create` grant only ever authorizes creating one snippet, not editing/deleting existing
					ones -- those routes don't accept the grant server-side either, so hiding these controls here is
					belt-and-suspenders, not the only guard. The list itself stays visible under a grant. */}
					{!grant && (
						<div className="mt-auto flex justify-end gap-2">
							{showConfirmDelete ? (
								<>
									<Button onPress={handleDelete}>
										<span className="text-red-500">Yes, delete</span>
									</Button>
									<Button onPress={() => setShowConfirmDelete(false)}>Cancel</Button>
								</>
							) : (
								<>
									<Button onPress={startEdit}>Edit</Button>
									<Button onPress={() => setShowConfirmDelete(true)}>
										<span className="text-red-500">Delete</span>
									</Button>
								</>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}
