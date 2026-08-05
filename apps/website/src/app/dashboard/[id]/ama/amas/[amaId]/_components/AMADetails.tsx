'use client';

import { updateAMAConfigSchema } from '@chatsift/api/ama-schemas';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NormalPromptFields } from '../../_components/NormalPromptFields';
import { PromptModeToggle } from '../../_components/PromptModeToggle';
import { PromptPreview } from '../../_components/PromptPreview';
import { APIError } from '@/api/error';
import type { AMAStats, PossiblyMissingChannelInfo, UpdateAMABody } from '@/api/routes/ama';
import { useAMA, useAMAStats, useExportAMAQuestions, useRepostPrompt, useUpdateAMA } from '@/api/routes/ama';
import type { GuildChannelInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { RawJsonField } from '@/components/common/RawJsonField';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { getChannelIcon } from '@/utils/channels';
import { formatDate, parseIntegerInput } from '@/utils/util';

const channelName = (channel: GuildChannelInfo | PossiblyMissingChannelInfo | null) =>
	channel && 'name' in channel ? channel.name : 'Unknown';

const allowedChannelTypes = [ChannelType.GuildText, ...threadTypes];

// `valence` picks the count's color the same way the Status badge above already colors "Active"/"Ended": accent
// for a good outcome, danger for a bad one. PENDING_*/FLAGGED are still awaiting a mod decision, so they stay
// neutral rather than borrowing a color that would misrepresent them as good or bad.
//
// `state` is a plain string literal here, not `keyof AMAStats['byState']` -- that type resolves to a (nominal) TS
// string enum, which plain literals aren't assignable to without a cast. Cast once at the `stats.byState[state]`
// read below instead of on every tuple entry.
const QUESTION_STATE_TILES = [
	{ state: 'PENDING_MOD_REVIEW', label: 'Pending Mod Review', valence: 'neutral' },
	{ state: 'PENDING_GUEST_REVIEW', label: 'Pending Guest Review', valence: 'neutral' },
	{ state: 'FLAGGED', label: 'Flagged', valence: 'neutral' },
	{ state: 'APPROVED', label: 'Approved', valence: 'good' },
	{ state: 'DENIED', label: 'Denied', valence: 'bad' },
] as const satisfies { label: string; state: string; valence: 'bad' | 'good' | 'neutral' }[];

const valenceClass = {
	neutral: 'text-primary dark:text-primary-dark',
	good: 'text-misc-accent',
	bad: 'text-misc-danger',
} as const satisfies Record<(typeof QUESTION_STATE_TILES)[number]['valence'], string>;

interface ConfigFormData {
	allowedQuestionUploads: string;
	answersChannelId: string;
	flaggedQueueId: string;
	guestQueueId: string;
	modQueueId: string;
	title: string;
}

type ConfigFormErrors = Partial<Record<keyof ConfigFormData, string>>;

const CONFIG_FIELDS = [
	'title',
	'answersChannelId',
	'modQueueId',
	'flaggedQueueId',
	'guestQueueId',
	'allowedQuestionUploads',
] as const satisfies (keyof ConfigFormData)[];

function mapConfigIssues(issues: readonly { message: string; path: PropertyKey[] }[]): ConfigFormErrors {
	const errors: ConfigFormErrors = {};

	for (const issue of issues) {
		const [first] = issue.path;
		if (typeof first === 'string' && (CONFIG_FIELDS as readonly string[]).includes(first)) {
			errors[first as keyof ConfigFormData] ??= issue.message;
		}
	}

	return errors;
}

function ChannelIcon({ channel }: { readonly channel: GuildChannelInfo | PossiblyMissingChannelInfo | null }) {
	if (!channel || !('type' in channel)) return null;
	const Icon = getChannelIcon(channel.type);
	return <Icon size={20} />;
}

interface PromptFormData {
	description: string;
	imageURL: string;
	plainText: string;
	promptRaw: string;
	thumbnailURL: string;
}

type PromptFormErrors = Partial<Record<keyof PromptFormData, string>>;

const PROMPT_FIELD_MAP: Record<string, keyof PromptFormData> = {
	description: 'description',
	plainText: 'plainText',
	imageURL: 'imageURL',
	thumbnailURL: 'thumbnailURL',
};

function mapPromptIssues(issues: readonly { message: string; path: PropertyKey[] }[]): PromptFormErrors {
	const errors: PromptFormErrors = {};

	for (const issue of issues) {
		const [first, second] = issue.path;

		if (first === 'prompt' && typeof second === 'string' && second in PROMPT_FIELD_MAP) {
			errors[PROMPT_FIELD_MAP[second]!] ??= issue.message;
		} else if (first === 'prompt_raw') {
			errors.promptRaw ??= issue.message;
		}
	}

	return errors;
}

function isValidJSON(value: string): boolean {
	try {
		JSON.parse(value);
		return true;
	} catch {
		return false;
	}
}

// `ama.promptJsonData` is always written by our own `JSON.stringify` server-side, but pretty-printing it here
// still shouldn't be allowed to crash the form on mount if a row ever ends up with something unexpected -- falls
// back to the raw stored string un-formatted so there's still something editable in the raw-JSON textarea instead
// of a blank page.
function prettyPrintOrRaw(value: string): string {
	try {
		return JSON.stringify(JSON.parse(value), null, 2);
	} catch {
		return value;
	}
}

// Best-effort: a prompt authored in "normal" mode stores exactly the shape `createAMA.ts` builds (`content` +
// `embeds[0].{description,image.url,thumbnail.url}`), so this round-trips cleanly. A prompt authored in raw mode
// (or edited raw since) can be an arbitrary Discord message payload, so this only ever pre-fills what it can
// recognize -- it never fails, it just leaves fields blank for shapes it doesn't understand.
function bestEffortPromptFields(promptJsonData: string): Omit<PromptFormData, 'promptRaw'> {
	try {
		const parsed = JSON.parse(promptJsonData) as Record<string, unknown>;
		const embeds = parsed['embeds'];
		const embed =
			Array.isArray(embeds) && embeds.length > 0 && typeof embeds[0] === 'object' && embeds[0] !== null
				? (embeds[0] as Record<string, unknown>)
				: null;
		const image = embed?.['image'] as Record<string, unknown> | undefined;
		const thumbnail = embed?.['thumbnail'] as Record<string, unknown> | undefined;

		return {
			plainText: typeof parsed['content'] === 'string' ? parsed['content'] : '',
			description: embed && typeof embed['description'] === 'string' ? embed['description'] : '',
			imageURL: typeof image?.['url'] === 'string' ? image['url'] : '',
			thumbnailURL: typeof thumbnail?.['url'] === 'string' ? thumbnail['url'] : '',
		};
	} catch {
		return { plainText: '', description: '', imageURL: '', thumbnailURL: '' };
	}
}

export function AMADetails() {
	const params = useParams<{ amaId: string; id: string }>();
	const router = useRouter();
	const [showEndConfirm, setShowEndConfirm] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [configForm, setConfigForm] = useState<ConfigFormData | null>(null);
	const [configErrors, setConfigErrors] = useState<ConfigFormErrors>({});
	const [promptForm, setPromptForm] = useState<PromptFormData | null>(null);
	const [promptMode, setPromptMode] = useState<'normal' | 'raw'>('raw');
	const [promptErrors, setPromptErrors] = useState<PromptFormErrors>({});

	const { data: ama, isLoading, error } = useAMA(params.id, params.amaId);
	const { data: guildInfo, isLoading: isGuildInfoLoading, error: guildInfoError } = useGuildInfo(params.id, 'AMA');
	const updateAMA = useUpdateAMA(params.id, params.amaId);
	const repostPrompt = useRepostPrompt(params.id, params.amaId);
	const { data: stats, isLoading: isStatsLoading } = useAMAStats(params.id, params.amaId);
	const exportQuestions = useExportAMAQuestions(params.id, params.amaId);

	// See GrantsList.tsx for why this also checks `ama === undefined`: a background refetch failure keeps the
	// previously-cached session around, and that stale-but-present data should keep rendering (including any
	// in-progress edit form) rather than being replaced by the full error state.
	if (error && ama === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<div className="space-y-6">
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (!ama) {
		return (
			<div className="text-center py-12">
				<p className="text-xl text-secondary dark:text-secondary-dark">AMA session not found</p>
			</div>
		);
	}

	const startEdit = () => {
		setConfigForm({
			title: ama.title,
			answersChannelId: ama.answersChannel.id,
			modQueueId: ama.modQueueChannel?.id ?? '',
			flaggedQueueId: ama.flaggedQueueChannel?.id ?? '',
			guestQueueId: ama.guestQueueChannel?.id ?? '',
			allowedQuestionUploads: String(ama.allowedQuestionUploads),
		});
		setConfigErrors({});
		setActionError(null);
		setSuccessMessage(null);
	};

	const cancelEdit = () => {
		setConfigForm(null);
		setConfigErrors({});
	};

	const updateConfigField = (field: keyof ConfigFormData, value: string | undefined) => {
		setConfigForm((prev) => (prev ? { ...prev, [field]: value ?? '' } : prev));
		setConfigErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSaveConfig = async () => {
		if (!configForm) return;

		const data = {
			title: configForm.title,
			answersChannelId: configForm.answersChannelId,
			modQueueId: configForm.modQueueId || null,
			flaggedQueueId: configForm.flaggedQueueId || null,
			guestQueueId: configForm.guestQueueId || null,
			allowedQuestionUploads: parseIntegerInput(configForm.allowedQuestionUploads),
		};

		const result = updateAMAConfigSchema.safeParse(data);
		if (!result.success) {
			setConfigErrors(mapConfigIssues(result.error.issues));
			return;
		}

		setActionError(null);

		try {
			await updateAMA.mutateAsync(result.data as UpdateAMABody);
			setConfigForm(null);
			setConfigErrors({});
			setSuccessMessage('Configuration updated.');
		} catch (error) {
			setActionError(error instanceof APIError ? error.message : 'Failed to update AMA. Please try again.');
			console.error('Failed to update AMA config:', error);
		}
	};

	const startPromptEdit = () => {
		setPromptForm({
			...bestEffortPromptFields(ama.promptJsonData),
			promptRaw: prettyPrintOrRaw(ama.promptJsonData),
		});
		setPromptMode('raw');
		setPromptErrors({});
		setActionError(null);
		setSuccessMessage(null);
	};

	const cancelPromptEdit = () => {
		setPromptForm(null);
		setPromptErrors({});
	};

	const updatePromptField = (field: keyof PromptFormData, value: string) => {
		setPromptForm((prev) => (prev ? { ...prev, [field]: value } : prev));
		setPromptErrors((prev) => ({ ...prev, [field]: undefined }));
	};

	const handleSavePrompt = async () => {
		if (!promptForm) return;

		if (promptMode === 'raw' && promptForm.promptRaw && !isValidJSON(promptForm.promptRaw)) {
			setPromptErrors({ promptRaw: 'Must be valid JSON' });
			return;
		}

		const body =
			promptMode === 'raw'
				? { prompt_raw: promptForm.promptRaw ? JSON.parse(promptForm.promptRaw) : {} }
				: {
						prompt: {
							description: promptForm.description || undefined,
							plainText: promptForm.plainText || undefined,
							imageURL: promptForm.imageURL || undefined,
							thumbnailURL: promptForm.thumbnailURL || undefined,
						},
					};

		const result = updateAMAConfigSchema.safeParse(body);
		if (!result.success) {
			setPromptErrors(mapPromptIssues(result.error.issues));
			return;
		}

		setActionError(null);

		try {
			await updateAMA.mutateAsync(result.data as UpdateAMABody);
			setPromptForm(null);
			setPromptErrors({});
			setSuccessMessage('Prompt message updated.');
		} catch (error) {
			if (error instanceof APIError && error.statusCode === 422) {
				setActionError(error.message || 'Invalid prompt data. Please check your JSON data and try again.');
				return;
			}

			if (error instanceof APIError && error.statusCode === 400) {
				const promptField = promptMode === 'raw' ? 'prompt_raw' : 'prompt';
				const candidates: [keyof PromptFormErrors, string | undefined][] = [
					['description', error.fieldError(promptField, 'description')],
					['plainText', error.fieldError(promptField, 'plainText')],
					['imageURL', error.fieldError(promptField, 'imageURL')],
					['thumbnailURL', error.fieldError(promptField, 'thumbnailURL')],
				];

				const newErrors: PromptFormErrors = Object.fromEntries(
					candidates.filter((entry): entry is [keyof PromptFormErrors, string] => entry[1] !== undefined),
				);

				setPromptErrors(newErrors);
				setActionError(Object.keys(newErrors).length > 0 ? null : error.message);
				return;
			}

			setActionError(error instanceof APIError ? error.message : 'Failed to update prompt. Please try again.');
			console.error('Failed to update AMA prompt:', error);
		}
	};

	const handlePastePrompt = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
		const pastedText = e.clipboardData.getData('text');

		try {
			const parsed = JSON.parse(pastedText);
			const formatted = JSON.stringify(parsed, null, 2);

			e.preventDefault();
			updatePromptField('promptRaw', formatted);
		} catch {
			// Not valid JSON, let default paste happen
		}
	};

	const handleEndAMA = async () => {
		if (!showEndConfirm) {
			setShowEndConfirm(true);
			return;
		}

		setActionError(null);

		try {
			await updateAMA.mutateAsync({ ended: true });
			router.push(`/dashboard/${params.id}/ama/amas`);
		} catch (error) {
			setActionError(error instanceof APIError ? error.message : 'Failed to end AMA. Please try again.');
			console.error('Failed to end AMA:', error);
		} finally {
			setShowEndConfirm(false);
		}
	};

	const handleExport = async () => {
		setActionError(null);
		setSuccessMessage(null);

		try {
			await exportQuestions.mutateAsync();
		} catch (error) {
			setActionError(error instanceof APIError ? error.message : 'Failed to export questions. Please try again.');
			console.error('Failed to export AMA questions:', error);
		}
	};

	const handleRepostPrompt = async () => {
		setActionError(null);
		setSuccessMessage(null);

		try {
			await repostPrompt.mutateAsync();
			setSuccessMessage('Prompt message reposted.');
		} catch (error) {
			setActionError(error instanceof APIError ? error.message : 'Failed to repost the prompt. Please try again.');
			console.error('Failed to repost prompt:', error);
		}
	};

	const editing = configForm !== null;
	const promptEditing = promptForm !== null;
	const channels = guildInfo?.channels ?? [];

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{actionError && (
				<p
					className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger lg:col-span-2"
					role="alert"
				>
					{actionError}
				</p>
			)}

			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent lg:col-span-2"
					role="status"
				>
					{successMessage}
				</p>
			)}

			{/* Session Information Card */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Session Information</h2>
					{!ama.ended && !editing && !promptEditing && (
						<Button
							className="px-3 py-1.5 text-sm bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors disabled:opacity-50"
							isDisabled={isGuildInfoLoading || (guildInfo === undefined && Boolean(guildInfoError))}
							onPress={startEdit}
							type="button"
						>
							Edit
						</Button>
					)}
				</div>
				<div className="space-y-4">
					{editing ? (
						<TextField
							error={configErrors.title}
							id="edit-title"
							label="Title"
							maxLength={255}
							onChange={(value) => updateConfigField('title', value)}
							value={configForm.title}
						/>
					) : (
						<div>
							<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Title</p>
							<p className="text-lg text-primary dark:text-primary-dark">{ama.title}</p>
						</div>
					)}

					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Status</p>
						<span
							className={`inline-block rounded px-3 py-1 text-sm font-medium ${
								ama.ended ? 'bg-misc-danger/10 text-misc-danger' : 'bg-misc-accent/10 text-misc-accent'
							}`}
						>
							{ama.ended ? 'Ended' : 'Active'}
						</span>
					</div>

					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Questions</p>
						<p className="text-lg text-primary dark:text-primary-dark">
							{ama.questionCount} {ama.questionCount === 1 ? 'question' : 'questions'}
						</p>
					</div>

					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Created</p>
						<p className="text-lg text-primary dark:text-primary-dark">{formatDate(new Date(ama.createdAt))}</p>
					</div>

					{editing ? (
						<TextField
							error={configErrors.allowedQuestionUploads}
							id="edit-allowed-uploads"
							label="Allowed Uploads"
							max={10}
							min={0}
							onChange={(value) => updateConfigField('allowedQuestionUploads', value)}
							type="number"
							value={configForm.allowedQuestionUploads}
						/>
					) : (
						<div>
							<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Allowed Uploads</p>
							<p className="text-lg text-primary dark:text-primary-dark">
								{ama.allowedQuestionUploads} {ama.allowedQuestionUploads === 1 ? 'file' : 'files'} per question
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Channels Card */}
			{/* `contain-inline-size`: the Prompt Channel help text below is a long line of plain-English text with no
			wrap opportunities counted toward CSS `max-content`, so without this its one-line width bubbles all the
			way up through `main`'s `mx-auto`-driven shrink-to-fit sizing in the root layout and grows the whole
			page. Containment isolates this card's content from that calculation while still letting the grid size
			the card normally, so the text underneath can stay `w-full` and wrap at the card's real width instead of
			being pinned to an arbitrary fixed max-width. */}
			<div className="contain-inline-size rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<h2 className="text-xl font-medium text-primary dark:text-primary-dark mb-4">Channels</h2>
				<div className="space-y-4">
					{editing ? (
						<>
							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={channels}
								error={configErrors.answersChannelId}
								label="Answers Channel"
								onChange={(value) => updateConfigField('answersChannelId', value)}
								required
								selectedId="edit-answersChannelId"
								value={configForm.answersChannelId}
							/>

							<div>
								<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Prompt Channel</p>
								<div className="mt-1 flex items-center gap-3">
									<ChannelIcon channel={ama.promptChannel} />
									<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.promptChannel)}</p>
								</div>
								<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
									Fixed to where the original prompt message was posted. If that message was deleted, use &quot;Repost
									Prompt Message&quot; below to recreate it in this same channel.
								</p>
							</div>

							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={channels}
								error={configErrors.modQueueId}
								label="Mod Queue (optional)"
								onChange={(value) => updateConfigField('modQueueId', value)}
								selectedId="edit-modQueueId"
								value={configForm.modQueueId}
							/>

							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={channels}
								error={configErrors.flaggedQueueId}
								label="Flagged Queue (optional)"
								onChange={(value) => updateConfigField('flaggedQueueId', value)}
								selectedId="edit-flaggedQueueId"
								value={configForm.flaggedQueueId}
							/>

							<ChannelSelect
								allowedTypes={allowedChannelTypes}
								channels={channels}
								error={configErrors.guestQueueId}
								label="Guest Queue (optional)"
								onChange={(value) => updateConfigField('guestQueueId', value)}
								selectedId="edit-guestQueueId"
								value={configForm.guestQueueId}
							/>
						</>
					) : (
						<>
							<div className="flex items-center gap-3">
								<ChannelIcon channel={ama.answersChannel} />
								<div>
									<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Answers Channel</p>
									<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.answersChannel)}</p>
								</div>
							</div>

							<div className="flex items-center gap-3">
								<ChannelIcon channel={ama.promptChannel} />
								<div>
									<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Prompt Channel</p>
									<p className="text-base text-primary dark:text-primary-dark">{channelName(ama.promptChannel)}</p>
								</div>
							</div>

							{/* Rendered unconditionally (with a "Not set" fallback) even when unconfigured, so this card has the
							same set of rows in view and edit mode -- otherwise toggling Edit adds up to three rows that
							weren't there a moment ago and shoves every card below it down the page. */}
							<div className="flex items-center gap-3">
								<ChannelIcon channel={ama.modQueueChannel} />
								<div>
									<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Mod Queue</p>
									<p className="text-base text-primary dark:text-primary-dark">
										{ama.modQueueChannel ? channelName(ama.modQueueChannel) : 'Not set'}
									</p>
								</div>
							</div>

							<div className="flex items-center gap-3">
								<ChannelIcon channel={ama.flaggedQueueChannel} />
								<div>
									<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Flagged Queue</p>
									<p className="text-base text-primary dark:text-primary-dark">
										{ama.flaggedQueueChannel ? channelName(ama.flaggedQueueChannel) : 'Not set'}
									</p>
								</div>
							</div>

							<div className="flex items-center gap-3">
								<ChannelIcon channel={ama.guestQueueChannel} />
								<div>
									<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Guest Queue</p>
									<p className="text-base text-primary dark:text-primary-dark">
										{ama.guestQueueChannel ? channelName(ama.guestQueueChannel) : 'Not set'}
									</p>
								</div>
							</div>
						</>
					)}
				</div>
			</div>

			{editing && (
				<div className="flex gap-3 lg:col-span-2">
					<Button
						className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
						onPress={handleSaveConfig}
						type="button"
					>
						Save Changes
					</Button>
					<Button
						className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
						onPress={cancelEdit}
						type="button"
					>
						Cancel
					</Button>
				</div>
			)}

			{/* Prompt Message Card */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark lg:col-span-2">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Prompt Message</h2>
					{ama.promptMessageExists && !ama.ended && !editing && !promptEditing && (
						<Button
							className="px-3 py-1.5 text-sm bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors disabled:opacity-50"
							onPress={startPromptEdit}
							type="button"
						>
							Edit
						</Button>
					)}
				</div>
				<div className="space-y-4">
					<div>
						<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Message Status</p>
						<span
							className={`inline-block rounded px-3 py-1 text-sm font-medium ${
								ama.promptMessageExists ? 'bg-misc-accent/10 text-misc-accent' : 'bg-misc-danger/10 text-misc-danger'
							}`}
						>
							{ama.promptMessageExists ? 'Active on Discord' : 'Message Deleted'}
						</span>
					</div>

					{!ama.promptMessageExists && !ama.ended && (
						<div className="pt-2">
							<Button
								className="bg-misc-accent text-white rounded-md hover:bg-misc-accent/90 transition-colors disabled:opacity-50"
								onPress={handleRepostPrompt}
								type="button"
							>
								Repost Prompt Message
							</Button>
							<p className="mt-2 text-sm text-secondary dark:text-secondary-dark">
								This will create a new prompt message in the prompt channel.
							</p>
						</div>
					)}

					{/* Renders the currently-live content -- `PromptPreview`'s raw mode parses arbitrary Discord message
					JSON, so this works whether the prompt was originally authored in normal or raw mode. Swapped out for
					the interactive (unsaved-edits) preview below once editing starts. */}
					{!promptEditing && <PromptPreview mode="raw" raw={ama.promptJsonData} />}

					{promptEditing && (
						<div className="space-y-4 pt-2">
							<PromptModeToggle mode={promptMode} onModeChange={setPromptMode} />

							<div className="grid gap-6 lg:grid-cols-2">
								<div>
									{promptMode === 'normal' ? (
										<NormalPromptFields
											description={promptForm.description}
											errors={promptErrors}
											imageURL={promptForm.imageURL}
											onDescriptionChange={(value) => updatePromptField('description', value)}
											onImageURLChange={(value) => updatePromptField('imageURL', value)}
											onPlainTextChange={(value) => updatePromptField('plainText', value)}
											onThumbnailURLChange={(value) => updatePromptField('thumbnailURL', value)}
											plainText={promptForm.plainText}
											thumbnailURL={promptForm.thumbnailURL}
										/>
									) : (
										<RawJsonField
											error={promptErrors.promptRaw}
											id="promptRaw"
											label="Raw JSON Prompt"
											onFormatClick={() => {
												try {
													const parsed = JSON.parse(promptForm.promptRaw);
													updatePromptField('promptRaw', JSON.stringify(parsed, null, 2));
												} catch {
													// Invalid JSON, ignore
												}
											}}
											onPaste={handlePastePrompt}
											onValueChange={(value) => updatePromptField('promptRaw', value)}
											value={promptForm.promptRaw}
										/>
									)}
								</div>

								{promptMode === 'normal' ? (
									<PromptPreview
										description={promptForm.description}
										imageURL={promptForm.imageURL}
										mode="normal"
										plainText={promptForm.plainText}
										thumbnailURL={promptForm.thumbnailURL}
										title={ama.title}
									/>
								) : (
									<PromptPreview mode="raw" raw={promptForm.promptRaw} />
								)}
							</div>

							<div className="flex gap-3">
								<Button
									className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
									isDisabled={updateAMA.isPending}
									onPress={handleSavePrompt}
									type="button"
								>
									Save Changes
								</Button>
								<Button
									className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
									onPress={cancelPromptEdit}
									type="button"
								>
									Cancel
								</Button>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Analytics & Export Card */}
			<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark lg:col-span-2">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Analytics &amp; Export</h2>
					<Button
						className="px-3 py-1.5 text-sm bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors disabled:opacity-50"
						isDisabled={exportQuestions.isPending}
						onPress={handleExport}
						type="button"
					>
						{exportQuestions.isPending ? 'Exporting…' : 'Export CSV'}
					</Button>
				</div>

				{isStatsLoading ? (
					<Skeleton className="h-24 w-full" />
				) : stats ? (
					<div className="space-y-4">
						<div>
							<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Total Questions</p>
							<p className="text-3xl font-semibold text-primary dark:text-primary-dark">{stats.total}</p>
						</div>

						<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
							{QUESTION_STATE_TILES.map(({ state, label, valence }) => (
								<div
									className="rounded-lg border border-on-secondary p-4 text-center dark:border-on-secondary-dark"
									key={state}
								>
									<p className={`text-2xl font-semibold ${valenceClass[valence]}`}>
										{stats.byState[state as keyof AMAStats['byState']]}
									</p>
									<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">{label}</p>
								</div>
							))}
						</div>
					</div>
				) : (
					<p className="text-sm text-secondary dark:text-secondary-dark">Unable to load question stats.</p>
				)}
			</div>

			{/* Actions Card */}
			{!ama.ended && (
				<div className="rounded-lg border border-misc-danger/20 bg-card p-6 dark:border-misc-danger/20 dark:bg-card-dark lg:col-span-2">
					<h2 className="text-xl font-medium text-misc-danger mb-4">Danger Zone</h2>
					{showEndConfirm ? (
						<div className="space-y-4">
							<p className="text-base text-primary dark:text-primary-dark">
								Are you sure you want to end this AMA? This action is <strong>irreversible</strong>.
							</p>
							<div className="flex gap-3">
								<Button
									className="px-3 py-2.5 bg-misc-danger text-white rounded-md hover:bg-misc-danger/90 transition-colors disabled:opacity-50"
									onPress={handleEndAMA}
									type="button"
								>
									Yes, End AMA
								</Button>
								<Button
									className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
									onPress={() => setShowEndConfirm(false)}
									type="button"
								>
									Cancel
								</Button>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							<p className="text-base text-primary dark:text-primary-dark">
								Ending an AMA will prevent new questions from being submitted. This action cannot be undone.
							</p>
							<Button
								className="px-3 py-2.5 bg-misc-danger text-white rounded-md hover:bg-misc-danger/90 transition-colors"
								onPress={handleEndAMA}
								type="button"
							>
								End AMA Session
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
