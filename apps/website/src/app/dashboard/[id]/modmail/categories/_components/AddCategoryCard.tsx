'use client';

import { createCategoryBodySchema } from '@chatsift/api/modmail-schemas';
import { useState } from 'react';
import { SnowflakeInput } from '../../../ama/amas/new/_components/SnowflakeInput';
import { APIError } from '@/api/error';
import type { CreateModmailCategoryBody } from '@/api/routes/modmail';
import { useCreateModmailCategory } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { parseIntegerInput } from '@/utils/util';

interface CategoryFormData {
	description: string;
	emoji: string;
	forumTagId: string;
	greetingMessage: string;
	name: string;
	sortOrder: string;
}

type CategoryFormErrors = Partial<Record<keyof CategoryFormData, string>>;

const EMPTY_FORM: CategoryFormData = {
	name: '',
	emoji: '',
	description: '',
	greetingMessage: '',
	forumTagId: '',
	sortOrder: '0',
};

const CATEGORY_FIELDS = [
	'name',
	'emoji',
	'description',
	'greetingMessage',
	'forumTagId',
	'sortOrder',
] as const satisfies (keyof CategoryFormData)[];

function mapCategoryIssues(issues: readonly { message: string; path: PropertyKey[] }[]): CategoryFormErrors {
	const errors: CategoryFormErrors = {};

	for (const issue of issues) {
		const [first] = issue.path;
		if (typeof first === 'string' && (CATEGORY_FIELDS as readonly string[]).includes(first)) {
			errors[first as keyof CategoryFormData] ??= issue.message;
		}
	}

	return errors;
}

interface AddCategoryCardProps {
	readonly guildId: string;
}

export function AddCategoryCard({ guildId }: AddCategoryCardProps) {
	const [form, setForm] = useState<CategoryFormData>(EMPTY_FORM);
	const [errors, setErrors] = useState<CategoryFormErrors>({});
	const createCategory = useCreateModmailCategory(guildId);

	const updateField = (field: keyof CategoryFormData, value: string) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSubmit = async () => {
		const data: CreateModmailCategoryBody = {
			name: form.name.trim(),
			emoji: form.emoji.trim() || null,
			description: form.description.trim() || null,
			greetingMessage: form.greetingMessage.trim() || null,
			forumTagId: form.forumTagId.trim() || null,
			sortOrder: parseIntegerInput(form.sortOrder),
		};

		const result = createCategoryBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapCategoryIssues(result.error.issues));
			return;
		}

		try {
			await createCategory.mutateAsync(result.data as CreateModmailCategoryBody);
			setForm(EMPTY_FORM);
			setErrors({});
		} catch (error) {
			if (error instanceof APIError) {
				if (error.statusCode === 409) {
					setErrors({ name: error.message });
				} else if (error.statusCode === 400) {
					setErrors(
						Object.fromEntries(
							CATEGORY_FIELDS.map((field) => [field, error.fieldError(field)]).filter(([, message]) => message),
						),
					);
				} else {
					setErrors({ name: error.message || 'Failed to create category' });
				}

				return;
			}

			setErrors({ name: 'Failed to create category' });
			console.error('Failed to create category', error);
		}
	};

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-dashed border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div>
				<label className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor="category-name">
					Name
				</label>
				<input
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					id="category-name"
					maxLength={100}
					onChange={(e) => updateField('name', e.target.value)}
					placeholder="e.g. Report a user"
					type="text"
					value={form.name}
				/>
				{errors.name && <p className="mt-1 text-sm text-misc-danger">{errors.name}</p>}
			</div>

			<div>
				<label className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" htmlFor="category-emoji">
					Emoji
				</label>
				<input
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					id="category-emoji"
					maxLength={64}
					onChange={(e) => updateField('emoji', e.target.value)}
					placeholder="🚩"
					type="text"
					value={form.emoji}
				/>
				{errors.emoji && <p className="mt-1 text-sm text-misc-danger">{errors.emoji}</p>}
			</div>

			<div>
				<label
					className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
					htmlFor="category-description"
				>
					Description
				</label>
				<textarea
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					id="category-description"
					maxLength={500}
					onChange={(e) => updateField('description', e.target.value)}
					rows={2}
					value={form.description}
				/>
				{errors.description && <p className="mt-1 text-sm text-misc-danger">{errors.description}</p>}
			</div>

			<div>
				<label
					className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
					htmlFor="category-greeting"
				>
					Greeting Message
				</label>
				<textarea
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					id="category-greeting"
					maxLength={2_000}
					onChange={(e) => updateField('greetingMessage', e.target.value)}
					rows={2}
					value={form.greetingMessage}
				/>
				<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">Falls back to the guild default if unset.</p>
				{errors.greetingMessage && <p className="mt-1 text-sm text-misc-danger">{errors.greetingMessage}</p>}
			</div>

			<SnowflakeInput
				error={errors.forumTagId}
				id="category-forum-tag"
				label="Forum Tag ID"
				onChange={(value) => updateField('forumTagId', value)}
				placeholder="Optional"
				value={form.forumTagId}
			/>

			<div>
				<label
					className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
					htmlFor="category-sort-order"
				>
					Sort Order
				</label>
				<input
					className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
					id="category-sort-order"
					min={0}
					onChange={(e) => updateField('sortOrder', e.target.value)}
					type="number"
					value={form.sortOrder}
				/>
				{errors.sortOrder && <p className="mt-1 text-sm text-misc-danger">{errors.sortOrder}</p>}
			</div>

			<div className="mt-auto flex justify-end">
				<Button isDisabled={!form.name.trim()} onPress={handleSubmit}>
					Add Category
				</Button>
			</div>
		</div>
	);
}
