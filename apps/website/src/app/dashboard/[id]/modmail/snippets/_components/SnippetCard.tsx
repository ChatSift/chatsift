'use client';

import { updateSnippetBodySchema } from '@chatsift/api/modmail-schemas';
import { useState } from 'react';
import { APIError } from '@/api/error';
import type { ModmailSnippet, UpdateModmailSnippetBody } from '@/api/routes/modmail';
import { useDeleteModmailSnippet, useUpdateModmailSnippet } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { normalizeSnippetName } from '@/utils/snippetName';
import { formatDate } from '@/utils/util';

interface SnippetFormData {
	content: string;
	name: string;
}

type SnippetFormErrors = Partial<Record<keyof SnippetFormData, string>>;

const SNIPPET_FIELDS = ['name', 'content'] as const satisfies (keyof SnippetFormData)[];

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
	return { name: snippet.name, content: snippet.content };
}

interface SnippetCardProps {
	readonly guildId: string;
	readonly snippet: ModmailSnippet;
}

export function SnippetCard({ guildId, snippet }: SnippetCardProps) {
	const [form, setForm] = useState<SnippetFormData | null>(null);
	const [errors, setErrors] = useState<SnippetFormErrors>({});
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
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

		const data: UpdateModmailSnippetBody = {
			name: normalizeSnippetName(form.name),
			content: form.content.trim(),
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

					<p className="text-xs text-secondary dark:text-secondary-dark">
						{snippet.timesUsed === 0
							? 'Never used'
							: `Used ${snippet.timesUsed} time${snippet.timesUsed === 1 ? '' : 's'}${
									snippet.lastUsedAt ? ` -- last used ${formatDate(new Date(snippet.lastUsedAt))}` : ''
								}`}
					</p>

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
				</>
			)}
		</div>
	);
}
