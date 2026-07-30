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
import { EmojiInput } from '@/components/common/EmojiInput';
import { FormActions } from '@/components/common/FormActions';
import { ForumTagSelect } from '@/components/common/ForumTagSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { TemplatePlaceholdersHint } from '@/components/common/TemplatePlaceholdersHint';
import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';
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

				<TextField
					error={errors.name}
					id="category-name"
					label="Name *"
					maxLength={100}
					onChange={(value) => updateField('name', value)}
					value={form.name}
				/>

				<EmojiInput
					emojis={guildInfo?.emojis ?? []}
					error={errors.emoji}
					id="category-emoji"
					label="Emoji"
					onChange={(value) => updateField('emoji', value)}
					value={form.emoji}
				/>

				<TextAreaField
					error={errors.description}
					id="category-description"
					label="Description"
					maxLength={500}
					onChange={(value) => updateField('description', value)}
					rows={2}
					value={form.description}
				/>

				<TextAreaField
					error={errors.greetingMessage}
					helper={
						<>
							<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
								Falls back to the{' '}
								<Link className="underline hover:text-misc-accent" href={`/dashboard/${guildId}/modmail/config`}>
									guild default
								</Link>{' '}
								if unset.
							</p>
							<TemplatePlaceholdersHint />
						</>
					}
					id="category-greeting"
					label="Greeting Message"
					maxLength={2_000}
					onChange={(value) => updateField('greetingMessage', value)}
					rows={2}
					value={form.greetingMessage}
				/>

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

				<TextField
					error={errors.maxConcurrentThreads}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							How many tickets a user may have open in this category specifically. Leave blank to use the{' '}
							<Link className="underline hover:text-misc-accent" href={`/dashboard/${guildId}/modmail/config`}>
								guild default
							</Link>
							{config ? ` (currently ${config.maxConcurrentThreads})` : ''}. Cannot exceed the guild default.
						</p>
					}
					id="category-max-concurrent-threads"
					label="Max Concurrent Threads Override"
					min={1}
					onChange={(value) => updateField('maxConcurrentThreads', value)}
					placeholder={config ? String(config.maxConcurrentThreads) : ''}
					type="number"
					value={form.maxConcurrentThreads}
				/>
			</div>

			<FormActions
				cancelLabel="Back"
				isSubmitting={updateCategory.isPending}
				onCancel={() => router.back()}
				pendingLabel="Saving..."
				submitLabel="Save Changes"
			/>
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
