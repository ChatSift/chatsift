'use client';

import { updateAMAConfigSchema } from '@chatsift/api/ama-schemas';
import { amaQuestionsChannel } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { ChannelType } from 'discord-api-types/v10';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NormalPromptFields } from '../../_components/NormalPromptFields';
import type { PromptMode } from '../../_components/PromptModeToggle';
import { PromptModeToggle } from '../../_components/PromptModeToggle';
import { PromptPreview } from '../../_components/PromptPreview';
import { AuthorAvatar } from '../questions/_components/AuthorAvatar';
import { userLabel } from '../questions/_components/userLabel';
import { QUESTION_STATE_TILES, valenceClass } from './questionStateTiles';
import { APIError } from '@/api/error';
import type { AMAStats, PossiblyMissingChannelInfo, UpdateAMABody } from '@/api/routes/ama';
import {
	invalidateAMAQuestions,
	useAMA,
	useAMAStats,
	useExportAMAQuestions,
	useRepostPrompt,
	useUpdateAMA,
} from '@/api/routes/ama';
import type { GuildChannelInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { ChannelSelect, threadTypes } from '@/components/common/ChannelSelect';
import { RawJsonField } from '@/components/common/RawJsonField';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useGuildAccess } from '@/hooks/useGuildAccess';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { getChannelIcon } from '@/utils/channels';
import { dateToDatetimeLocalValue, datetimeLocalValueToISOString, formatDate, parseIntegerInput } from '@/utils/util';

const channelName = (channel: GuildChannelInfo | PossiblyMissingChannelInfo | null) =>
	channel && 'name' in channel ? channel.name : 'Unknown';

const allowedChannelTypes = [ChannelType.GuildText, ...threadTypes];

interface ConfigFormData {
	allowedQuestionUploads: string;
	answersChannelId: string;
	guestIds: string[];
	preparedAnswersEnabled: boolean;
	queueId: string;
	reviewEnabled: boolean;
	scheduledCloseAt: string;
	title: string;
}

type ConfigFormErrors = Partial<Record<keyof ConfigFormData, string>>;

const CONFIG_FIELDS = [
	'title',
	'answersChannelId',
	'queueId',
	'guestIds',
	'allowedQuestionUploads',
	'scheduledCloseAt',
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
	const queryClient = useQueryClient();
	// Same channel `QuestionsList.tsx` subscribes to -- its stat tiles below are invalidated together with
	// questions server-side already (`invalidateAMAQuestions`), so there's no separate "AMA details changed"
	// channel to introduce.
	useRealtimeInvalidate(amaQuestionsChannel(params.id, params.amaId), () => {
		void invalidateAMAQuestions(queryClient, params.id, params.amaId);
	});
	const [showCloseConfirm, setShowCloseConfirm] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [configForm, setConfigForm] = useState<ConfigFormData | null>(null);
	// Snapshot of `scheduledCloseAt` as loaded, in the same datetime-local string form as `configForm`'s --
	// `handleSaveConfig` diffs against this so an edit that never touches the date (e.g. just the title)
	// doesn't resend it. That matters beyond a no-op write: the datetime-local input only has minute
	// precision, so round-tripping an untouched value through it and back to ISO can shift it by
	// truncating seconds, and if the stored date is already close to "now" that resend could even trip the
	// "must be in the future" validation on a field the user never meant to change.
	const [initialScheduledCloseAt, setInitialScheduledCloseAt] = useState('');
	const [configErrors, setConfigErrors] = useState<ConfigFormErrors>({});
	const [promptForm, setPromptForm] = useState<PromptFormData | null>(null);
	const [promptMode, setPromptMode] = useState<PromptMode>('raw');
	const [promptErrors, setPromptErrors] = useState<PromptFormErrors>({});
	const [linkCopied, setLinkCopied] = useState(false);

	const { data: ama, isLoading, error } = useAMA(params.id, params.amaId);
	const { data: guildInfo, isLoading: isGuildInfoLoading, error: guildInfoError } = useGuildInfo(params.id, 'AMA');
	const updateAMA = useUpdateAMA(params.id, params.amaId);
	const repostPrompt = useRepostPrompt(params.id, params.amaId);
	const { data: stats, isLoading: isStatsLoading } = useAMAStats(params.id, params.amaId);
	const exportQuestions = useExportAMAQuestions(params.id, params.amaId);

	// Guests can view this whole page (session info, channels, stats) -- they just can't edit any of it
	// or take the maintenance actions below (config edit, prompt edit, repost, export, close/reopen
	// submissions). Every mutating button/card on this page is gated on `canManage`. None of them are gated
	// on the session being open anymore (#299) -- a closed session is still actively worked on.
	const { canManage } = useGuildAccess(params.id);

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
		const scheduledCloseAt = ama.scheduledCloseAt ? dateToDatetimeLocalValue(new Date(ama.scheduledCloseAt)) : '';

		setConfigForm({
			title: ama.title,
			answersChannelId: ama.answersChannel.id,
			queueId: ama.queueChannel?.id ?? '',
			reviewEnabled: ama.reviewEnabled,
			preparedAnswersEnabled: ama.preparedAnswersEnabled,
			allowedQuestionUploads: String(ama.allowedQuestionUploads),
			scheduledCloseAt,
			guestIds: ama.guestIds,
		});
		setInitialScheduledCloseAt(scheduledCloseAt);
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

	const updateConfigCheckbox = (field: 'preparedAnswersEnabled' | 'reviewEnabled', value: boolean) => {
		setConfigForm((prev) => (prev ? { ...prev, [field]: value } : prev));
	};

	const updateGuestId = (index: number, value: string) => {
		setConfigForm((prev) =>
			prev ? { ...prev, guestIds: prev.guestIds.map((id, i) => (i === index ? value : id)) } : prev,
		);
	};

	const addGuestId = () => {
		setConfigForm((prev) => (prev ? { ...prev, guestIds: [...prev.guestIds, ''] } : prev));
	};

	const removeGuestId = (index: number) => {
		setConfigForm((prev) => (prev ? { ...prev, guestIds: prev.guestIds.filter((_id, i) => i !== index) } : prev));
	};

	const handleSaveConfig = async () => {
		if (!configForm) return;

		const data = {
			title: configForm.title,
			answersChannelId: configForm.answersChannelId,
			queueId: configForm.reviewEnabled ? configForm.queueId || null : null,
			reviewEnabled: configForm.reviewEnabled,
			preparedAnswersEnabled: configForm.preparedAnswersEnabled,
			allowedQuestionUploads: parseIntegerInput(configForm.allowedQuestionUploads),
			guestIds: [...new Set(configForm.guestIds.map((id) => id.trim()).filter(Boolean))],
			// Omitted entirely (not sent as `undefined`) when untouched -- see `initialScheduledCloseAt`'s
			// comment for why resending an unchanged value isn't safe to do unconditionally.
			...(configForm.scheduledCloseAt !== initialScheduledCloseAt && {
				scheduledCloseAt: datetimeLocalValueToISOString(configForm.scheduledCloseAt) ?? null,
			}),
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

	// Normal-mode fields and the raw JSON textarea are two independent representations of the same in-progress
	// edit -- without re-deriving one from the other on toggle, switching modes after typing would silently show
	// (and, on save, submit) stale content from whenever the form was opened. Raw -> normal only re-derives when
	// the raw text is currently valid JSON, so a mid-edit typo in raw mode doesn't blow away the normal fields.
	const handlePromptModeChange = (mode: PromptMode) => {
		setPromptForm((prev) => {
			if (!prev) {
				return prev;
			}

			if (mode === 'raw' && promptMode === 'normal') {
				const messageBody = {
					content: prev.plainText || undefined,
					embeds: [
						{
							description: prev.description || undefined,
							image: prev.imageURL ? { url: prev.imageURL } : undefined,
							thumbnail: prev.thumbnailURL ? { url: prev.thumbnailURL } : undefined,
						},
					],
				};

				return { ...prev, promptRaw: JSON.stringify(messageBody, null, 2) };
			}

			if (mode === 'normal' && promptMode === 'raw' && isValidJSON(prev.promptRaw)) {
				return { ...prev, ...bestEffortPromptFields(prev.promptRaw) };
			}

			return prev;
		});

		setPromptMode(mode);
		setPromptErrors({});
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
			const newErrors = mapPromptIssues(result.error.issues);
			setPromptErrors(newErrors);
			// `mapPromptIssues` only recognizes issues nested under `prompt`/`prompt_raw` -- a root-level refine
			// issue (e.g. the schema's "at least one field" / "cannot provide both" checks) maps to nothing, which
			// would otherwise fail this validation silently with no feedback at all.
			if (Object.keys(newErrors).length === 0) {
				setActionError(result.error.issues[0]?.message ?? 'Invalid prompt data.');
			}

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
				// `prompt_raw`'s schema shape (`content`/`embeds`) has no field overlap with the normal-mode
				// sub-fields below, so raw mode reads the whole-field error directly instead of probing sub-paths
				// that can never match.
				if (promptMode === 'raw') {
					const rawError = error.fieldError('prompt_raw');
					setPromptErrors(rawError ? { promptRaw: rawError } : {});
					setActionError(rawError ? null : error.message);
					return;
				}

				const candidates: [keyof PromptFormErrors, string | undefined][] = [
					['description', error.fieldError('prompt', 'description')],
					['plainText', error.fieldError('prompt', 'plainText')],
					['imageURL', error.fieldError('prompt', 'imageURL')],
					['thumbnailURL', error.fieldError('prompt', 'thumbnailURL')],
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

	// Closing only stops new submissions (#299) -- the rest of this page (triage, answers, config, export) stays
	// just as relevant afterwards, so this deliberately stays put instead of navigating back to the session list.
	const handleCloseSubmissions = async () => {
		if (!showCloseConfirm) {
			setShowCloseConfirm(true);
			return;
		}

		setActionError(null);
		setSuccessMessage(null);

		try {
			await updateAMA.mutateAsync({ ended: true });
			setSuccessMessage('Question submissions closed. Existing questions can still be reviewed and answered.');
		} catch (error) {
			setActionError(
				error instanceof APIError ? error.message : 'Failed to close question submissions. Please try again.',
			);
			console.error('Failed to close AMA question submissions:', error);
		} finally {
			setShowCloseConfirm(false);
		}
	};

	const handleReopenSubmissions = async () => {
		setActionError(null);
		setSuccessMessage(null);

		try {
			await updateAMA.mutateAsync({ ended: false });
			setSuccessMessage('Question submissions reopened.');
		} catch (error) {
			setActionError(
				error instanceof APIError ? error.message : 'Failed to reopen question submissions. Please try again.',
			);
			console.error('Failed to reopen AMA question submissions:', error);
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

	const handleCopyPublicLink = async () => {
		const url = `${window.location.origin}/ama-answers/${ama.shareToken}`;
		await navigator.clipboard.writeText(url);
		setLinkCopied(true);
		setTimeout(() => setLinkCopied(false), 2_000);
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
		<div className="flex flex-col gap-6">
			<div className="rounded-lg border border-misc-accent bg-misc-accent/10 p-6">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div>
						<h2 className="text-xl font-medium text-primary dark:text-primary-dark">Question Triage</h2>
						<p className="text-sm text-secondary dark:text-secondary-dark">
							Browse, tag, prepare answers, and merge duplicate questions.
						</p>
					</div>
					<Button
						className="shrink-0 rounded-md bg-misc-accent px-5 py-2.5 text-base font-medium text-white transition-colors hover:opacity-90"
						onPress={() => router.push(`/dashboard/${params.id}/ama/amas/${params.amaId}/questions`)}
						type="button"
					>
						View Questions
					</Button>
				</div>
			</div>

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
						{canManage && !editing && !promptEditing && (
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
							<p className="text-sm font-medium text-secondary dark:text-secondary-dark mb-1">Question Submissions</p>
							<span
								className={`inline-block rounded px-3 py-1 text-sm font-medium ${
									ama.ended
										? 'bg-on-tertiary text-secondary dark:bg-on-tertiary-dark dark:text-secondary-dark'
										: 'bg-misc-accent/10 text-misc-accent'
								}`}
							>
								{ama.ended ? 'Closed' : 'Open'}
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

						{editing ? (
							<TextField
								error={configErrors.scheduledCloseAt}
								helper={
									<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
										Optional - automatically closes question submissions at this date/time. Clear to cancel it.
									</p>
								}
								id="edit-scheduled-close-at"
								label="Scheduled Close Date"
								onChange={(value) => updateConfigField('scheduledCloseAt', value)}
								type="datetime-local"
								value={configForm.scheduledCloseAt}
							/>
						) : (
							<div>
								<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Scheduled Close Date</p>
								<p className="text-lg text-primary dark:text-primary-dark">
									{ama.scheduledCloseAt ? formatDate(new Date(ama.scheduledCloseAt)) : 'Not set'}
								</p>
							</div>
						)}

						<div>
							<p className="mb-1 text-sm font-medium text-secondary dark:text-secondary-dark">Public Answers Page</p>
							<p className="mb-2 text-sm text-secondary dark:text-secondary-dark">
								A read-only page listing asked questions and their answers - no login required.
							</p>
							<div className="flex items-center gap-3">
								<Button
									className="px-3 py-1.5 text-sm bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
									onPress={handleCopyPublicLink}
									type="button"
								>
									Copy Public Answers Link
								</Button>
								{linkCopied && <span className="text-sm text-misc-accent">Copied!</span>}
							</div>
						</div>
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

								<div>
									<label className="flex items-center gap-2" htmlFor="edit-review-enabled">
										<input
											checked={configForm.reviewEnabled}
											className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
											id="edit-review-enabled"
											onChange={(e) => updateConfigCheckbox('reviewEnabled', e.target.checked)}
											type="checkbox"
										/>
										<span className="text-sm font-medium text-secondary dark:text-secondary-dark">Enable review</span>
									</label>
									{configForm.reviewEnabled && (
										<div className="mt-2 space-y-3">
											<ChannelSelect
												allowedTypes={allowedChannelTypes}
												channels={channels}
												error={configErrors.queueId}
												label="Queue (optional)"
												onChange={(value) => updateConfigField('queueId', value)}
												selectedId="edit-queueId"
												value={configForm.queueId}
											/>
											{!configForm.queueId && (
												<p className="rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-sm text-blue-600 dark:text-blue-400">
													No channel picked - review will be managed entirely from the dashboard.
												</p>
											)}
										</div>
									)}
								</div>

								<div>
									<h3 className="text-xl font-medium text-primary dark:text-primary-dark">Guests (optional)</h3>
									<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
										Known guest-answerer user IDs. Once at least one is added, &quot;answered by&quot; becomes a picker
										restricted to this list instead of a free-text ID.
									</p>
									{configErrors.guestIds && <p className="mt-1 text-sm text-misc-danger">{configErrors.guestIds}</p>}
									<div className="mt-2 space-y-2">
										{configForm.guestIds.map((guestId, index) => (
											<div className="flex items-center gap-2" key={index}>
												<input
													aria-label={`Guest ${index + 1} user ID`}
													className="w-full rounded-md border border-on-secondary bg-card px-3 py-2 text-sm text-primary focus:border-misc-accent focus:outline-none dark:border-on-secondary-dark dark:bg-card-dark dark:text-primary-dark"
													onChange={(e) => updateGuestId(index, e.target.value)}
													placeholder="Discord user ID"
													type="text"
													value={guestId}
												/>
												<Button
													aria-label={`Remove guest ${index + 1}`}
													className="h-9 shrink-0 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
													onPress={() => removeGuestId(index)}
													type="button"
												>
													Remove
												</Button>
											</div>
										))}
										<Button
											className="h-9 border border-on-secondary px-3 text-sm dark:border-on-secondary-dark"
											onPress={addGuestId}
											type="button"
										>
											+ Add Guest
										</Button>
									</div>
								</div>

								<div>
									<label className="flex items-center gap-2" htmlFor="edit-prepared-answers-enabled">
										<input
											checked={configForm.preparedAnswersEnabled}
											className="h-4 w-4 rounded border-on-secondary dark:border-on-secondary-dark"
											id="edit-prepared-answers-enabled"
											onChange={(e) => updateConfigCheckbox('preparedAnswersEnabled', e.target.checked)}
											type="checkbox"
										/>
										<span className="text-sm font-medium text-secondary dark:text-secondary-dark">
											Enable prepared answers
										</span>
									</label>
								</div>
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
							same set of rows in view and edit mode -- otherwise toggling Edit adds a row that wasn't
							there a moment ago and shoves every card below it down the page. */}
								<div className="flex items-center gap-3">
									<ChannelIcon channel={ama.queueChannel} />
									<div>
										<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Queue</p>
										<p className="text-base text-primary dark:text-primary-dark">
											{ama.reviewEnabled
												? ama.queueChannel
													? channelName(ama.queueChannel)
													: 'Dashboard only'
												: 'Disabled'}
										</p>
									</div>
								</div>

								<div>
									<p className="text-sm font-medium text-secondary dark:text-secondary-dark">Prepared Answers</p>
									<p className="text-lg text-primary dark:text-primary-dark">
										{ama.preparedAnswersEnabled ? 'Enabled' : 'Disabled'}
									</p>
								</div>

								<div>
									<h3 className="mb-3 text-xl font-medium text-primary dark:text-primary-dark">Guests</h3>
									{ama.guests.length === 0 ? (
										<p className="text-lg text-primary dark:text-primary-dark">None configured</p>
									) : (
										<div className="flex flex-col gap-3">
											{ama.guests.map((guest) => {
												const guestId = typeof guest === 'string' ? guest : guest.id;
												return (
													<div className="flex items-center gap-3" key={guestId}>
														<AuthorAvatar className="h-8 w-8 rounded-full" user={guest} />
														<div>
															<p className="text-base text-primary dark:text-primary-dark">{userLabel(guest)}</p>
															<p className="text-xs text-secondary dark:text-secondary-dark">{guestId}</p>
														</div>
													</div>
												);
											})}
										</div>
									)}
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
						{canManage && ama.promptMessageExists && !editing && !promptEditing && (
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

						{/* The one action still gated on submissions being open, matching `amaRepostSelect.ts`'s own guard:
					the prompt message is the submit-a-question entry point, so reposting it on a closed session just
					hands people a button that turns them away. Reopen first, then repost. */}
						{canManage && !ama.promptMessageExists && !ama.ended && (
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
								<PromptModeToggle mode={promptMode} onModeChange={handlePromptModeChange} />

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
						{canManage && (
							<Button
								className="px-3 py-1.5 text-sm bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors disabled:opacity-50"
								isDisabled={exportQuestions.isPending}
								onPress={handleExport}
								type="button"
							>
								{exportQuestions.isPending ? 'Exporting…' : 'Export CSV'}
							</Button>
						)}
					</div>

					{isStatsLoading ? (
						<Skeleton className="h-24 w-full" />
					) : stats ? (
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
							<div className="rounded-lg border border-on-secondary p-4 text-center dark:border-on-secondary-dark">
								<p className="text-2xl font-semibold text-primary dark:text-primary-dark">{stats.total}</p>
								<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">Total Questions</p>
							</div>
							<div className="rounded-lg border border-on-secondary p-4 text-center dark:border-on-secondary-dark">
								<p className="text-2xl font-semibold text-primary dark:text-primary-dark">
									{stats.mergedDuplicatesCount}
								</p>
								<p className="mt-1 text-xs text-secondary dark:text-secondary-dark">Merged Duplicates</p>
							</div>
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
					) : (
						<p className="text-sm text-secondary dark:text-secondary-dark">Unable to load question stats.</p>
					)}
				</div>

				{/* Question Submissions Card */}
				{canManage && (
					<div className="rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark lg:col-span-2">
						<h2 className="mb-4 text-xl font-medium text-primary dark:text-primary-dark">Question Submissions</h2>
						{ama.ended ? (
							<div className="space-y-4">
								<p className="text-base text-primary dark:text-primary-dark">
									This AMA is closed to new questions - the &quot;Submit a question&quot; button turns people away.
									Everything else still works: questions already submitted can be reviewed, answered and exported.
								</p>
								<Button
									className="px-3 py-2.5 bg-misc-accent text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
									isDisabled={updateAMA.isPending}
									onPress={handleReopenSubmissions}
									type="button"
								>
									Reopen Question Submissions
								</Button>
								{/* A scheduled close date that has already lapsed is cleared server-side on reopen, otherwise
							ama-bot's sweep would close the session again within a minute -- called out here so that
							silently-cleared date isn't a surprise. */}
								{ama.scheduledCloseAt && new Date(ama.scheduledCloseAt).getTime() <= Date.now() && (
									<p className="text-sm text-secondary dark:text-secondary-dark">
										Reopening also clears the scheduled close date, since it has already passed.
									</p>
								)}
							</div>
						) : showCloseConfirm ? (
							<div className="space-y-4">
								<p className="text-base text-primary dark:text-primary-dark">
									Close question submissions for this AMA? Questions already submitted stay fully manageable - you just
									stop receiving new ones. You can reopen submissions here at any time.
								</p>
								<div className="flex gap-3">
									<Button
										className="px-3 py-2.5 bg-misc-danger text-white rounded-md hover:bg-misc-danger/90 transition-colors disabled:opacity-50"
										isDisabled={updateAMA.isPending}
										onPress={handleCloseSubmissions}
										type="button"
									>
										Yes, Close Submissions
									</Button>
									<Button
										className="px-3 py-2.5 bg-on-tertiary dark:bg-on-tertiary-dark text-primary dark:text-primary-dark rounded-md hover:bg-on-secondary dark:hover:bg-on-secondary-dark transition-colors"
										onPress={() => setShowCloseConfirm(false)}
										type="button"
									>
										Cancel
									</Button>
								</div>
							</div>
						) : (
							<div className="space-y-4">
								<p className="text-base text-primary dark:text-primary-dark">
									This AMA is accepting new questions. Closing submissions stops new ones from coming in; reviewing and
									answering what is already here carries on as normal.
								</p>
								<Button
									className="px-3 py-2.5 bg-misc-danger text-white rounded-md hover:bg-misc-danger/90 transition-colors"
									onPress={handleCloseSubmissions}
									type="button"
								>
									Close Question Submissions
								</Button>
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
