'use client';

import { createCategoryBodySchema } from '@chatsift/api/modmail-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CategoryFormData, CategoryFormErrors } from '../../_components/categoryForm';
import { mapCategoryApiError, mapCategoryIssues } from '../../_components/categoryForm';
import { GreetingMessageHelper, MaxConcurrentThreadsHelper } from '../../_components/categoryFormHelpers';
import { useGuildInfo } from '@/api/routes/guilds';
import type { CreateModmailCategoryBody } from '@/api/routes/modmail';
import {
	useCreateModmailCategory,
	useModForumTags,
	useModmailCategories,
	useModmailConfig,
} from '@/api/routes/modmail';
import { EmojiInput } from '@/components/common/EmojiInput';
import { FormActions } from '@/components/common/FormActions';
import { ForumTagSelect } from '@/components/common/ForumTagSelect';
import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';

const EMPTY_FORM: CategoryFormData = {
	name: '',
	emoji: '',
	description: '',
	greetingMessage: '',
	forumTagId: '',
	maxConcurrentThreads: '',
};

export function CreateCategoryForm() {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<CategoryFormData>(EMPTY_FORM);
	const [errors, setErrors] = useState<CategoryFormErrors>({});
	const createCategory = useCreateModmailCategory(guildId);
	const { data: categories } = useModmailCategories(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'MODMAIL');
	const { data: config } = useModmailConfig(guildId);
	const { tags: forumTags, modForumConfigured } = useModForumTags(guildId);

	const updateField = (field: keyof CategoryFormData, value: string) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		// `categories` isn't loaded yet -- bail rather than default `sortOrder` to 0, which could silently
		// collide with an existing category actually at sortOrder 0 instead of appending to the end.
		if (categories === undefined) {
			return;
		}

		const data: CreateModmailCategoryBody = {
			name: form.name.trim(),
			emoji: form.emoji.trim() || null,
			description: form.description.trim() || null,
			greetingMessage: form.greetingMessage.trim() || null,
			forumTagId: form.forumTagId.trim() || null,
			maxConcurrentThreads: form.maxConcurrentThreads.trim() ? Number(form.maxConcurrentThreads) : null,
			// New categories always append at the end -- reordering afterwards happens via the move up/down
			// controls on each card, not by hand-picking a number here.
			sortOrder: categories.length,
		};

		const result = createCategoryBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapCategoryIssues(result.error.issues));
			return;
		}

		try {
			await createCategory.mutateAsync(result.data);
			router.replace(`/dashboard/${guildId}/modmail/categories`);
		} catch (error) {
			setErrors(mapCategoryApiError(error, 'create'));
		}
	};

	return (
		<form className="mt-8 space-y-6" onSubmit={handleSubmit}>
			<div className="space-y-4">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Category Details</h2>

				<TextField
					error={errors.name}
					id="category-name"
					label="Name *"
					maxLength={100}
					onChange={(value) => updateField('name', value)}
					placeholder="e.g. Report a user"
					value={form.name}
				/>

				<EmojiInput
					emojis={guildInfo?.emojis ?? []}
					error={errors.emoji}
					id="category-emoji"
					label="Emoji"
					onChange={(value) => updateField('emoji', value)}
					placeholder="🚩"
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
					helper={<GreetingMessageHelper guildId={guildId} />}
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
					helper={<MaxConcurrentThreadsHelper config={config} guildId={guildId} />}
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
				isSubmitDisabled={!form.name.trim() || categories === undefined}
				isSubmitting={createCategory.isPending}
				onCancel={() => router.back()}
				pendingLabel="Creating..."
				submitLabel="Add Category"
			/>
		</form>
	);
}
