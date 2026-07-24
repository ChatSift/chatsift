'use client';

import { updateCategoryBodySchema } from '@chatsift/api/modmail-schemas';
import { useState } from 'react';
import { SnowflakeInput } from '../../../ama/amas/new/_components/SnowflakeInput';
import { APIError } from '@/api/error';
import type { ModmailCategory, UpdateModmailCategoryBody } from '@/api/routes/modmail';
import { useDeleteModmailCategory, useUpdateModmailCategory } from '@/api/routes/modmail';
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

function formFromCategory(category: ModmailCategory): CategoryFormData {
	return {
		name: category.name,
		emoji: category.emoji ?? '',
		description: category.description ?? '',
		greetingMessage: category.greetingMessage ?? '',
		forumTagId: category.forumTagId ?? '',
		sortOrder: String(category.sortOrder),
	};
}

interface CategoryCardProps {
	readonly category: ModmailCategory;
	readonly guildId: string;
}

export function CategoryCard({ guildId, category }: CategoryCardProps) {
	const [form, setForm] = useState<CategoryFormData | null>(null);
	const [errors, setErrors] = useState<CategoryFormErrors>({});
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
	const updateCategory = useUpdateModmailCategory(guildId, category.id);
	const deleteCategory = useDeleteModmailCategory(guildId);

	const editing = form !== null;

	const startEdit = () => {
		setForm(formFromCategory(category));
		setErrors({});
	};

	const cancelEdit = () => {
		setForm(null);
		setErrors({});
	};

	const updateField = (field: keyof CategoryFormData, value: string) => {
		setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSave = async () => {
		if (!form) {
			return;
		}

		const data: UpdateModmailCategoryBody = {
			name: form.name.trim(),
			emoji: form.emoji.trim() || null,
			description: form.description.trim() || null,
			greetingMessage: form.greetingMessage.trim() || null,
			forumTagId: form.forumTagId.trim() || null,
			sortOrder: parseIntegerInput(form.sortOrder),
		};

		const result = updateCategoryBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapCategoryIssues(result.error.issues));
			return;
		}

		try {
			await updateCategory.mutateAsync(result.data as UpdateModmailCategoryBody);
			setForm(null);
			setErrors({});
		} catch (error) {
			if (error instanceof APIError) {
				setErrors({ name: error.statusCode === 409 ? error.message : error.message || 'Failed to update category' });
				return;
			}

			setErrors({ name: 'Failed to update category' });
			console.error('Failed to update category', error);
		}
	};

	const handleDelete = async () => {
		await deleteCategory.mutateAsync(category.id);
		setShowConfirmDelete(false);
	};

	return (
		<div className="flex w-full flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			{editing ? (
				<>
					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor={`category-name-${category.id}`}
						>
							Name
						</label>
						<input
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`category-name-${category.id}`}
							maxLength={100}
							onChange={(e) => updateField('name', e.target.value)}
							type="text"
							value={form.name}
						/>
						{errors.name && <p className="mt-1 text-sm text-misc-danger">{errors.name}</p>}
					</div>

					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor={`category-emoji-${category.id}`}
						>
							Emoji
						</label>
						<input
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`category-emoji-${category.id}`}
							maxLength={64}
							onChange={(e) => updateField('emoji', e.target.value)}
							type="text"
							value={form.emoji}
						/>
						{errors.emoji && <p className="mt-1 text-sm text-misc-danger">{errors.emoji}</p>}
					</div>

					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor={`category-description-${category.id}`}
						>
							Description
						</label>
						<textarea
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`category-description-${category.id}`}
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
							htmlFor={`category-greeting-${category.id}`}
						>
							Greeting Message
						</label>
						<textarea
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`category-greeting-${category.id}`}
							maxLength={2_000}
							onChange={(e) => updateField('greetingMessage', e.target.value)}
							rows={2}
							value={form.greetingMessage}
						/>
						{errors.greetingMessage && <p className="mt-1 text-sm text-misc-danger">{errors.greetingMessage}</p>}
					</div>

					<SnowflakeInput
						error={errors.forumTagId}
						id={`category-forum-tag-${category.id}`}
						label="Forum Tag ID"
						onChange={(value) => updateField('forumTagId', value)}
						placeholder="Optional"
						value={form.forumTagId}
					/>

					<div>
						<label
							className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
							htmlFor={`category-sort-order-${category.id}`}
						>
							Sort Order
						</label>
						<input
							className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
							id={`category-sort-order-${category.id}`}
							min={0}
							onChange={(e) => updateField('sortOrder', e.target.value)}
							type="number"
							value={form.sortOrder}
						/>
						{errors.sortOrder && <p className="mt-1 text-sm text-misc-danger">{errors.sortOrder}</p>}
					</div>

					<div className="mt-auto flex justify-end gap-2">
						<Button onPress={handleSave}>Save</Button>
						<Button onPress={cancelEdit}>Cancel</Button>
					</div>
				</>
			) : (
				<>
					<div className="flex items-center gap-2">
						{category.emoji && <span className="text-lg">{category.emoji}</span>}
						<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-lg font-medium text-primary dark:text-primary-dark">
							{category.name}
						</p>
					</div>

					{category.description && (
						<p className="text-sm text-secondary dark:text-secondary-dark">{category.description}</p>
					)}

					<p className="text-xs text-secondary dark:text-secondary-dark">
						{category.forumTagId ? `Forum tag: ${category.forumTagId}` : 'No forum tag set'}
					</p>
					<p className="text-xs text-secondary dark:text-secondary-dark">Sort order: {category.sortOrder}</p>

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
