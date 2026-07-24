'use client';

import { createSnippetBodySchema } from '@chatsift/api/modmail-schemas';
import { useState } from 'react';
import { APIError } from '@/api/error';
import type { CreateModmailSnippetBody } from '@/api/routes/modmail';
import { useCreateModmailSnippet } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { normalizeSnippetName } from '@/utils/snippetName';

interface SnippetFormData {
	content: string;
	name: string;
}

type SnippetFormErrors = Partial<Record<keyof SnippetFormData, string>>;

const EMPTY_FORM: SnippetFormData = { name: '', content: '' };

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

interface AddSnippetCardProps {
	readonly guildId: string;
}

export function AddSnippetCard({ guildId }: AddSnippetCardProps) {
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

	const handleSubmit = async () => {
		const data: CreateModmailSnippetBody = {
			name: normalizeSnippetName(form.name),
			content: form.content.trim(),
		};

		const result = createSnippetBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapSnippetIssues(result.error.issues));
			return;
		}

		try {
			await createSnippet.mutateAsync(result.data as CreateModmailSnippetBody);
			setForm(EMPTY_FORM);
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
					setErrors({ name: error.message || 'Failed to create snippet' });
				}

				return;
			}

			setErrors({ name: 'Failed to create snippet' });
			console.error('Failed to create snippet', error);
		}
	};

	const previewName = normalizeSnippetName(form.name);

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-dashed border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div>
				<label className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor="snippet-name">
					Name *
				</label>
				<input
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
				{errors.name && <p className="mt-1 text-sm text-misc-danger">{errors.name}</p>}
			</div>

			<div>
				<label
					className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
					htmlFor="snippet-content"
				>
					Content *
				</label>
				<textarea
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					id="snippet-content"
					maxLength={2_000}
					onChange={(e) => updateField('content', e.target.value)}
					rows={4}
					value={form.content}
				/>
				{errors.content && <p className="mt-1 text-sm text-misc-danger">{errors.content}</p>}
			</div>

			<div className="mt-auto flex justify-end">
				<Button isDisabled={!form.name.trim() || !form.content.trim()} onPress={handleSubmit}>
					Add Snippet
				</Button>
			</div>
		</div>
	);
}
