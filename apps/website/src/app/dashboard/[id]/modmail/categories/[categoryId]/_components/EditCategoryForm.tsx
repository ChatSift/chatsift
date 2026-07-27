'use client';

import { updateCategoryBodySchema } from '@chatsift/api/modmail-schemas';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CategoryFormData, CategoryFormErrors } from '../../_components/categoryForm';
import { mapCategoryApiError, mapCategoryIssues } from '../../_components/categoryForm';
import { useGuildInfo } from '@/api/routes/guilds';
import type { ModmailCategory, UpdateModmailCategoryBody } from '@/api/routes/modmail';
import {
	useModForumTags,
	useModmailCategories,
	useModmailConfig,
	useUpdateModmailCategory,
} from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { EmojiInput } from '@/components/common/EmojiInput';
import { ForumTagSelect } from '@/components/common/ForumTagSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { TemplatePlaceholdersHint } from '@/components/common/TemplatePlaceholdersHint';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

function formFromCategory(category: ModmailCategory): CategoryFormData {
	return {
		name: category.name,
		emoji: category.emoji ?? '',
		description: category.description ?? '',
		greetingMessage: category.greetingMessage ?? '',
		forumTagId: category.forumTagId ?? '',
		maxConcurrentThreads: category.maxConcurrentThreads === null ? '' : String(category.maxConcurrentThreads),
	};
}

interface EditCategoryFormProps {
	readonly category: ModmailCategory;
}

export function EditCategoryForm({ category }: EditCategoryFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<CategoryFormData>(() => formFromCategory(category));
	const [errors, setErrors] = useState<CategoryFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const updateCategory = useUpdateModmailCategory(guildId, category.id);
	const { data: guildInfo } = useGuildInfo(guildId, 'MODMAIL');
	const { data: config } = useModmailConfig(guildId);
	const { tags: forumTags, modForumConfigured } = useModForumTags(guildId);

	const updateField = (field: keyof CategoryFormData, value: string) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		const data: UpdateModmailCategoryBody = {
			name: form.name.trim(),
			emoji: form.emoji.trim() || null,
			description: form.description.trim() || null,
			greetingMessage: form.greetingMessage.trim() || null,
			forumTagId: form.forumTagId.trim() || null,
			maxConcurrentThreads: form.maxConcurrentThreads.trim() ? Number(form.maxConcurrentThreads) : null,
		};

		const result = updateCategoryBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapCategoryIssues(result.error.issues));
			setSuccessMessage(null);
			return;
		}

		setSuccessMessage(null);

		try {
			await updateCategory.mutateAsync(result.data);
			setErrors({});
			setSuccessMessage('Category updated.');
		} catch (error) {
			setErrors(mapCategoryApiError(error, 'update'));
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
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Category Details</h2>

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="category-name"
					>
						Name *
					</label>
					<input
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="category-name"
						maxLength={100}
						onChange={(e) => updateField('name', e.target.value)}
						type="text"
						value={form.name}
					/>
					{errors.name && <p className="mt-1 text-sm text-misc-danger">{errors.name}</p>}
				</div>

				<EmojiInput
					emojis={guildInfo?.emojis ?? []}
					error={errors.emoji}
					id="category-emoji"
					label="Emoji"
					onChange={(value) => updateField('emoji', value)}
					value={form.emoji}
				/>

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
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Falls back to the{' '}
						<Link className="underline hover:text-misc-accent" href={`/dashboard/${guildId}/modmail/config`}>
							guild default
						</Link>{' '}
						if unset.
					</p>
					<TemplatePlaceholdersHint />
					{errors.greetingMessage && <p className="mt-1 text-sm text-misc-danger">{errors.greetingMessage}</p>}
				</div>

				{modForumConfigured ? (
					<ForumTagSelect
						error={errors.forumTagId}
						id="category-forum-tag"
						label="Forum Tag"
						onChange={(value) => updateField('forumTagId', value ?? '')}
						tags={forumTags ?? []}
						value={form.forumTagId}
					/>
				) : (
					<p className="text-sm text-secondary dark:text-secondary-dark">
						No Mod Forum configured — set one on the Config page to route this category to a forum tag.
					</p>
				)}

				<div>
					<label
						className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark"
						htmlFor="category-max-concurrent-threads"
					>
						Max Concurrent Threads Override
					</label>
					<input
						className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-primary focus:border-misc-accent focus:outline-none focus:ring-2 focus:ring-misc-accent dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
						id="category-max-concurrent-threads"
						min={1}
						onChange={(e) => updateField('maxConcurrentThreads', e.target.value)}
						placeholder={config ? String(config.maxConcurrentThreads) : ''}
						type="number"
						value={form.maxConcurrentThreads}
					/>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						How many tickets a user may have open in this category specifically. Leave blank to use the{' '}
						<Link className="underline hover:text-misc-accent" href={`/dashboard/${guildId}/modmail/config`}>
							guild default
						</Link>
						{config ? ` (currently ${config.maxConcurrentThreads})` : ''}. Cannot exceed the guild default.
					</p>
					{errors.maxConcurrentThreads && (
						<p className="mt-1 text-sm text-misc-danger">{errors.maxConcurrentThreads}</p>
					)}
				</div>
			</div>

			<div className="flex gap-4">
				<Button
					className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
					isDisabled={updateCategory.isPending}
					type="submit"
				>
					{updateCategory.isPending ? 'Saving...' : 'Save Changes'}
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

export function EditCategoryFormLoader() {
	const params = useParams<{ categoryId: string; id: string }>();
	const { data: categories, isLoading, error } = useModmailCategories(params.id);

	if (error && categories === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !categories) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-32 w-full" />
			</div>
		);
	}

	const category = categories.find((candidate) => String(candidate.id) === params.categoryId);
	if (!category) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Category not found</p>
			</div>
		);
	}

	return <EditCategoryForm category={category} />;
}
