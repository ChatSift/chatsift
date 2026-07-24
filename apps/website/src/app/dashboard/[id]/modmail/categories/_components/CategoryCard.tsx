'use client';

import { updateCategoryBodySchema } from '@chatsift/api/modmail-schemas';
import Link from 'next/link';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { useGuildInfo } from '@/api/routes/guilds';
import type { ModmailCategory, UpdateModmailCategoryBody } from '@/api/routes/modmail';
import { useDeleteModmailCategory, useModForumTags, useUpdateModmailCategory } from '@/api/routes/modmail';
import { Button } from '@/components/common/Button';
import { Emoji } from '@/components/common/Emoji';
import { EmojiInput } from '@/components/common/EmojiInput';
import { ForumTagSelect, tagEmojiValue } from '@/components/common/ForumTagSelect';
import { SvgChevronDown } from '@/components/icons/SvgChevronDown';

interface CategoryFormData {
	description: string;
	emoji: string;
	forumTagId: string;
	greetingMessage: string;
	name: string;
}

type CategoryFormErrors = Partial<Record<keyof CategoryFormData, string>>;

const CATEGORY_FIELDS = [
	'name',
	'emoji',
	'description',
	'greetingMessage',
	'forumTagId',
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
	};
}

interface CategoryCardProps {
	readonly canMoveDown: boolean;
	readonly canMoveUp: boolean;
	readonly category: ModmailCategory;
	readonly guildId: string;
	onMoveDown(): void;
	onMoveUp(): void;
}

export function CategoryCard({ guildId, category, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: CategoryCardProps) {
	const [form, setForm] = useState<CategoryFormData | null>(null);
	const [errors, setErrors] = useState<CategoryFormErrors>({});
	const [showConfirmDelete, setShowConfirmDelete] = useState(false);
	const updateCategory = useUpdateModmailCategory(guildId, category.id);
	const deleteCategory = useDeleteModmailCategory(guildId);
	const { data: guildInfo } = useGuildInfo(guildId, 'MODMAIL');
	const { tags: forumTags, modForumConfigured } = useModForumTags(guildId);

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
		};

		const result = updateCategoryBodySchema.safeParse(data);
		if (!result.success) {
			setErrors(mapCategoryIssues(result.error.issues));
			return;
		}

		try {
			await updateCategory.mutateAsync(result.data);
			setForm(null);
			setErrors({});
		} catch (error) {
			if (error instanceof APIError) {
				if (error.statusCode === 409) {
					// `conflictField` is a structured indicator the API attaches to this route's two possible
					// conflicts (duplicate name, duplicate forum tag) -- see updateCategory.ts/sendBoom.ts. Falls
					// back to `name` only as defense-in-depth against a future conflict this route doesn't
					// currently throw and hasn't set one for; it should never actually happen.
					const field = error.conflictField === 'forumTagId' ? 'forumTagId' : 'name';
					setErrors({ [field]: error.message });
				} else if (error.statusCode === 400) {
					setErrors(
						Object.fromEntries(
							CATEGORY_FIELDS.map((field) => [field, error.fieldError(field)]).filter(([, message]) => message),
						),
					);
				} else {
					setErrors({ name: error.message || 'Failed to update category' });
				}

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
							Name *
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

					<EmojiInput
						emojis={guildInfo?.emojis ?? []}
						error={errors.emoji}
						id={`category-emoji-${category.id}`}
						label="Emoji"
						onChange={(value) => updateField('emoji', value)}
						value={form.emoji}
					/>

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

					{modForumConfigured ? (
						<ForumTagSelect
							error={errors.forumTagId}
							id={`category-forum-tag-${category.id}`}
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

					<div className="mt-auto flex justify-end gap-2">
						<Button onPress={handleSave}>Save</Button>
						<Button onPress={cancelEdit}>Cancel</Button>
					</div>
				</>
			) : (
				<>
					<div className="flex items-center justify-between gap-2">
						<div className="flex min-w-0 flex-1 items-center gap-2">
							{category.emoji && <Emoji className="h-7 w-7 shrink-0 text-2xl" value={category.emoji} />}
							<p className="overflow-hidden overflow-ellipsis whitespace-nowrap text-xl font-semibold text-primary dark:text-primary-dark">
								{category.name}
							</p>
						</div>

						<div className="flex shrink-0 flex-col gap-0.5">
							<Button aria-label="Move up" className="p-1" isDisabled={!canMoveUp} onPress={onMoveUp} type="button">
								<SvgChevronDown className="rotate-180" size={16} />
							</Button>
							<Button
								aria-label="Move down"
								className="p-1"
								isDisabled={!canMoveDown}
								onPress={onMoveDown}
								type="button"
							>
								<SvgChevronDown size={16} />
							</Button>
						</div>
					</div>

					<div className="flex flex-col gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wide text-secondary/70 dark:text-secondary-dark/70">
								Description
							</p>
							<p className="text-sm text-primary dark:text-primary-dark">
								{category.description || (
									<span className="italic text-secondary dark:text-secondary-dark">Not set</span>
								)}
							</p>
						</div>

						<div>
							<p className="text-xs font-semibold uppercase tracking-wide text-secondary/70 dark:text-secondary-dark/70">
								Greeting Message
							</p>
							<p className="text-sm text-primary dark:text-primary-dark">
								{category.greetingMessage || (
									<span className="italic text-secondary dark:text-secondary-dark">
										Falls back to the{' '}
										<Link className="underline hover:text-misc-accent" href={`/dashboard/${guildId}/modmail/config`}>
											guild default
										</Link>
									</span>
								)}
							</p>
						</div>

						<div>
							<p className="text-xs font-semibold uppercase tracking-wide text-secondary/70 dark:text-secondary-dark/70">
								Forum Tag
							</p>
							<p className="flex items-center gap-1.5 text-sm text-primary dark:text-primary-dark">
								{category.forumTagId ? (
									(() => {
										const matchedTag = forumTags?.find((tag) => tag.id === category.forumTagId);
										const emojiValue = matchedTag && tagEmojiValue(matchedTag);
										return (
											<>
												{emojiValue && <Emoji className="h-4 w-4 shrink-0" value={emojiValue} />}
												{matchedTag?.name ?? `Unknown tag (${category.forumTagId})`}
											</>
										);
									})()
								) : (
									<span className="italic text-secondary dark:text-secondary-dark">Not set</span>
								)}
							</p>
						</div>
					</div>

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
