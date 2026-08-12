'use client';

import { createSocialInteractionBodySchema, updateSocialInteractionBodySchema } from '@chatsift/api/social-schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { InteractionFormData, InteractionFormErrors } from './interactionForm';
import { mapInteractionApiError, mapInteractionIssues, normalizeInteractionName } from './interactionForm';
import type { CreateSocialInteractionBody, SocialInteraction, UpdateSocialInteractionBody } from '@/api/routes/social';
import { useCreateSocialInteraction, useSocialInteractions, useUpdateSocialInteraction } from '@/api/routes/social';
import { ColorField, validateColorInput } from '@/components/common/ColorField';
import { FormActions } from '@/components/common/FormActions';
import { Skeleton } from '@/components/common/Skeleton';
import { TextAreaField } from '@/components/common/TextAreaField';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

const EMPTY_FORM: InteractionFormData = {
	name: '',
	content: '',
	color: '',
	plainContent: '',
	attachmentUrl: '',
	embed: false,
	allowTargets: false,
};

function formFromInteraction(interaction: SocialInteraction): InteractionFormData {
	return {
		name: interaction.name,
		content: interaction.content,
		color: interaction.color ?? '',
		plainContent: interaction.plainContent ?? '',
		attachmentUrl: interaction.attachmentUrl ?? '',
		embed: interaction.embed,
		allowTargets: interaction.allowTargets,
	};
}

interface SocialInteractionFormProps {
	/**
	 * The interaction being edited, or `undefined` when creating one. Unlike the channel/role/reward forms these
	 * are two different endpoints (POST vs PATCH), but the fields are identical, so the shape stays shared.
	 */
	readonly interaction?: SocialInteraction | undefined;
}

export function SocialInteractionForm({ interaction }: SocialInteractionFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const [form, setForm] = useState<InteractionFormData>(() =>
		interaction ? formFromInteraction(interaction) : EMPTY_FORM,
	);
	const [errors, setErrors] = useState<InteractionFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const createInteraction = useCreateSocialInteraction(guildId);
	// Both mutations are instantiated unconditionally (they're hooks); only one of them is ever fired. The `0`
	// stands in for the id the create path doesn't have and never reaches a request.
	const updateInteraction = useUpdateSocialInteraction(guildId, interaction?.id ?? 0);

	const updateField = <TField extends keyof InteractionFormData>(field: TField, value: InteractionFormData[TField]) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		// A blank color is "no color picked", a malformed one is a typo -- and since the API stores the hex
		// string as typed, a bad one would otherwise be posted and rejected as a whole-form error.
		const colorError = validateColorInput(form.color);
		if (colorError) {
			setErrors({ color: colorError });
			setSuccessMessage(null);
			return;
		}

		const attachmentUrl = form.attachmentUrl.trim();
		// The embed-only fields are cleared rather than carried when the interaction isn't an embed: they'd be
		// invisible in the editor and silently reappear the moment someone turned the embed back on.
		const data = {
			name: normalizeInteractionName(form.name),
			content: form.content.trim(),
			embed: form.embed,
			allowTargets: form.allowTargets,
			color: form.embed ? form.color.trim().toLowerCase() || null : null,
			plainContent: form.embed ? form.plainContent.trim() || null : null,
			attachmentUrl: form.embed ? attachmentUrl || null : null,
		} satisfies CreateSocialInteractionBody & UpdateSocialInteractionBody;

		const schema = interaction ? updateSocialInteractionBodySchema : createSocialInteractionBodySchema;
		const result = schema.safeParse(data);
		if (!result.success) {
			setErrors(mapInteractionIssues(result.error.issues));
			setSuccessMessage(null);
			return;
		}

		setSuccessMessage(null);

		try {
			if (interaction) {
				await updateInteraction.mutateAsync(result.data as UpdateSocialInteractionBody);
				setErrors({});
				setSuccessMessage('Interaction updated.');
				return;
			}

			await createInteraction.mutateAsync(result.data as CreateSocialInteractionBody);
			router.replace(`/dashboard/${guildId}/social/interactions`);
		} catch (error) {
			setErrors(mapInteractionApiError(error, interaction ? 'update' : 'create'));
		}
	};

	const previewName = normalizeInteractionName(form.name);
	const isSubmitting = interaction ? updateInteraction.isPending : createInteraction.isPending;

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
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Interaction Details</h2>

				<TextField
					error={errors.name}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Anyone in the server will be able to run <span className="font-mono">/{previewName || '...'}</span>.
							Lowercase letters, digits, dashes and underscores only.
						</p>
					}
					id="social-interaction-name"
					label="Name *"
					maxLength={32}
					onBlur={() => updateField('name', normalizeInteractionName(form.name))}
					onChange={(value) => updateField('name', value)}
					placeholder="hug"
					value={form.name}
				/>

				<TextAreaField
					error={errors.content}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Supports{' '}
							<code className="rounded bg-on-secondary px-1 py-0.5 text-xs dark:bg-on-secondary-dark">
								{'{{author}}'}
							</code>{' '}
							(whoever ran the command) and{' '}
							<code className="rounded bg-on-secondary px-1 py-0.5 text-xs dark:bg-on-secondary-dark">
								{'{{targets}}'}
							</code>{' '}
							(who they pointed it at), both as mentions.
						</p>
					}
					id="social-interaction-content"
					label="Content *"
					maxLength={2_000}
					onChange={(value) => updateField('content', value)}
					rows={4}
					value={form.content}
				/>

				<div>
					<label className="flex items-center gap-2" htmlFor="social-interaction-allow-targets">
						<input
							checked={form.allowTargets}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="social-interaction-allow-targets"
							onChange={(event) => updateField('allowTargets', event.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Let it target people</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Adds up to three optional user options to the command, which render into{' '}
						<code className="rounded bg-on-secondary px-1 py-0.5 text-xs dark:bg-on-secondary-dark">
							{'{{targets}}'}
						</code>
						. All optional, so running it with nobody named still works.
					</p>
				</div>

				<div>
					<label className="flex items-center gap-2" htmlFor="social-interaction-embed">
						<input
							checked={form.embed}
							className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
							id="social-interaction-embed"
							onChange={(event) => updateField('embed', event.target.checked)}
							type="checkbox"
						/>
						<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Send as an embed</span>
					</label>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Off by default -- the content is posted as a plain message, and an image URL in it is left for Discord to
						unfurl.
					</p>
				</div>

				{form.embed && (
					<>
						<ColorField
							error={errors.color}
							helper={
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									The embed&apos;s accent stripe. Leave blank for Discord&apos;s default.
								</p>
							}
							id="social-interaction-color"
							label="Embed color"
							onChange={(value) => updateField('color', value)}
							value={form.color}
						/>

						<TextField
							error={errors.attachmentUrl}
							helper={
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									Optional. Shown as the embed&apos;s image -- must be a direct link to an image.
								</p>
							}
							id="social-interaction-attachment-url"
							label="Image URL"
							onChange={(value) => updateField('attachmentUrl', value)}
							placeholder="https://..."
							type="url"
							value={form.attachmentUrl}
						/>

						<TextAreaField
							error={errors.plainContent}
							helper={
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									Optional. Posted as ordinary message text alongside the embed, so it can mention people the embed
									can&apos;t.
								</p>
							}
							id="social-interaction-plain-content"
							label="Text outside the embed"
							maxLength={2_000}
							onChange={(value) => updateField('plainContent', value)}
							rows={2}
							value={form.plainContent}
						/>
					</>
				)}
			</div>

			<FormActions
				isSubmitDisabled={!form.name.trim() || !form.content.trim()}
				isSubmitting={isSubmitting}
				onCancel={() => router.back()}
				pendingLabel={interaction ? 'Saving...' : 'Creating...'}
				submitLabel={interaction ? 'Save Changes' : 'Add Interaction'}
			/>
		</form>
	);
}

export function EditSocialInteractionFormLoader() {
	const params = useParams<{ id: string; interactionId: string }>();
	const { data: interactions, isLoading, error } = useSocialInteractions(params.id);

	if (error && interactions === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !interactions) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-32 w-full" />
			</div>
		);
	}

	const interaction = interactions.find((candidate) => String(candidate.id) === params.interactionId);
	if (!interaction) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Interaction not found</p>
			</div>
		);
	}

	return <SocialInteractionForm interaction={interaction} />;
}
