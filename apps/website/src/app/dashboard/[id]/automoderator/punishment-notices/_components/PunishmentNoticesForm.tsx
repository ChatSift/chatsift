'use client';

import { setPunishmentNoticesBodySchema } from '@chatsift/api/automoderator-schemas';
import { automoderatorPunishmentNoticesChannel, PUNISHMENT_NOTICE_MAX_LENGTH } from '@chatsift/core';
import { APIError } from '@chatsift/web-core/api/error';
import { Button } from '@chatsift/web-core/components/Button';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { TextAreaField } from '@chatsift/web-core/components/TextAreaField';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { queryKeys } from '@/api/queryClient';
import type {
	PunishmentNoticeScope,
	SetAutomoderatorPunishmentNoticesBody,
} from '@/api/routes/automoderatorPunishmentNotices';
import {
	useAutomoderatorPunishmentNotices,
	useSetAutomoderatorPunishmentNotices,
} from '@/api/routes/automoderatorPunishmentNotices';
import { AppealLinkCopy } from '@/components/common/AppealLinkCopy';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

/**
 * The five actions that DM the person they happen to, in the order a server escalates through them. UNMUTE and
 * UNBAN are absent for the reason `automoderator_notice_scope` gives: neither ever DMs.
 */
const OVERRIDE_SCOPES = ['WARN', 'MUTE', 'KICK', 'SOFTBAN', 'BAN'] as const satisfies PunishmentNoticeScope[];

const SCOPE_LABELS: Record<(typeof OVERRIDE_SCOPES)[number], string> = {
	WARN: 'Warn',
	MUTE: 'Mute',
	KICK: 'Kick',
	SOFTBAN: 'Softban',
	BAN: 'Ban',
};

type NoticeDraft = Record<PunishmentNoticeScope, string>;

const EMPTY_DRAFT: NoticeDraft = { DEFAULT: '', WARN: '', MUTE: '', KICK: '', SOFTBAN: '', BAN: '' };

const SCOPE_KEYS = Object.keys(EMPTY_DRAFT) as PunishmentNoticeScope[];

function draftFromNotices(notices: readonly { content: string; scope: PunishmentNoticeScope }[]): NoticeDraft {
	const seeded = { ...EMPTY_DRAFT };
	for (const notice of notices) {
		seeded[notice.scope] = notice.content;
	}

	return seeded;
}

function sameDraft(left: NoticeDraft, right: NoticeDraft): boolean {
	return SCOPE_KEYS.every((scope) => left[scope] === right[scope]);
}

/**
 * Per-guild text appended to the DM the bot sends when it punishes somebody (#232 P3b).
 *
 * One screen, one Save, six boxes: the general notice plus an override per action that DMs. An empty box is
 * that scope having no notice at all -- there is no separate "off" switch, and clearing a box is what deletes
 * the row. See `setPunishmentNoticesBodySchema` for why the save is one declarative PUT.
 */
export function PunishmentNoticesForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorPunishmentNoticesChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.punishmentNotices(guildId) });
	});

	const { data, isLoading, error } = useAutomoderatorPunishmentNotices(guildId);
	const setNotices = useSetAutomoderatorPunishmentNotices(guildId);

	const [draft, setDraft] = useState<NoticeDraft | null>(null);
	const [errors, setErrors] = useState<Partial<NoticeDraft>>({});
	const [actionError, setActionError] = useState<string | null>(null);
	const [touched, setTouched] = useState(false);

	// Seeded on first load *and* re-seeded by any later refetch the guild's realtime channel triggers -- but
	// only while nothing has been typed. Every other config form here seeds once and stops, which is the right
	// trade when a save is a PATCH of one field; this one PUTs the whole set, so a form left sitting on a
	// snapshot another manager has since replaced would offer a Save that silently reverts their work. Editing
	// pins the draft exactly as before: a background refetch still must not clobber what is being typed.
	useEffect(() => {
		if (!data || touched) {
			return;
		}

		const seeded = draftFromNotices(data.notices);
		// Returning the previous reference when nothing changed is what keeps this from re-rendering on every
		// refetch that answered with the same notices.
		setDraft((previous) => (previous && sameDraft(previous, seeded) ? previous : seeded));
	}, [data, touched]);

	if (error && data === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !data || draft === null) {
		return <Skeleton className="h-96 w-full rounded-lg" />;
	}

	const { appealLink } = data;

	const stored = draftFromNotices(data.notices);
	const isDirty = SCOPE_KEYS.some((scope) => draft[scope].trim() !== stored[scope].trim());

	const updateField = (scope: PunishmentNoticeScope, value: string) => {
		setTouched(true);
		setDraft((previous) => (previous ? { ...previous, [scope]: value } : previous));
		setErrors((previous) => ({ ...previous, [scope]: undefined }));
		setActionError(null);
	};

	const save = async () => {
		// The scopes in a stable order, so a validation issue's `['notices', index, 'content']` path maps back
		// to the box that produced it rather than to whichever one happened to be non-empty first.
		const scopes = (Object.keys(EMPTY_DRAFT) as PunishmentNoticeScope[]).filter((scope) => draft[scope].trim() !== '');

		const body: SetAutomoderatorPunishmentNoticesBody = {
			notices: scopes.map((scope) => ({ scope, content: draft[scope].trim() })),
		};

		const parsed = setPunishmentNoticesBodySchema.safeParse(body);
		if (!parsed.success) {
			const mapped: Partial<NoticeDraft> = {};

			for (const issue of parsed.error.issues) {
				const index = issue.path[1];
				const scope = typeof index === 'number' ? scopes[index] : undefined;
				if (scope) {
					mapped[scope] ??= issue.message;
				} else {
					setActionError(issue.message);
				}
			}

			setErrors(mapped);
			return;
		}

		setActionError(null);
		setErrors({});

		try {
			await setNotices.mutateAsync(parsed.data as SetAutomoderatorPunishmentNoticesBody);
			// What was typed is now what is stored, so the form goes back to following the server -- otherwise
			// one edit would pin it to this snapshot for the rest of the session.
			setTouched(false);
		} catch (caughtError) {
			setActionError(caughtError instanceof APIError ? caughtError.message : 'Failed to save. Please try again.');
		}
	};

	const addAppealLink = (link: string) => {
		const current = draft.BAN.trim();
		// A second press is a no-op rather than a second copy of the link: the button is right next to Copy, and
		// pressing the wrong one is the obvious mistake to make.
		if (current.includes(link)) {
			return;
		}

		const sentence = `You can appeal this ban at ${link}`;
		const proposed = current ? `${current}\n\n${sentence}` : sentence;

		// The textarea's own `maxLength` does not apply to a write from code, so without this the button can
		// build a draft only the save rejects -- an error about a limit, pointing at text the user did not type.
		if (proposed.length > PUNISHMENT_NOTICE_MAX_LENGTH) {
			setErrors((previous) => ({
				...previous,
				BAN: `Adding the link would take this over ${PUNISHMENT_NOTICE_MAX_LENGTH} characters. Shorten the notice first.`,
			}));
			return;
		}

		updateField('BAN', proposed);
	};

	return (
		<div className="flex flex-col gap-4">
			{actionError && (
				<p className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger" role="alert">
					{actionError}
				</p>
			)}

			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<div>
					<h3 className="text-sm font-medium text-primary dark:text-primary-dark">General notice</h3>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Added to the end of every punishment DM the bot sends, after the line naming the action and the reason.
						Nobody is DMed for an unmute or an unban, so nothing here reaches those.
					</p>
				</div>

				<TextAreaField
					error={errors.DEFAULT}
					helper="Leave empty for no notice at all. Discord markdown works, and so do links."
					id="automoderator-notice-default"
					label="Added to every punishment DM"
					maxLength={PUNISHMENT_NOTICE_MAX_LENGTH}
					onChange={(value) => updateField('DEFAULT', value)}
					placeholder="Read the rules at #rules before coming back."
					rows={3}
					value={draft.DEFAULT}
				/>
			</div>

			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<div>
					<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Per-action notices</h3>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						A notice here <strong>replaces</strong> the general one for that action rather than being added to it. Leave
						one empty to use the general notice.
					</p>
				</div>

				{appealLink ? (
					<div className="flex flex-col gap-2 rounded-md border border-on-secondary p-3 dark:border-on-secondary-dark">
						<p className="text-sm text-secondary dark:text-secondary-dark">This server accepts appeals.</p>
						<AppealLinkCopy link={appealLink} />
					</div>
				) : (
					<div className="flex flex-col gap-2 rounded-md border border-on-secondary p-3 dark:border-on-secondary-dark">
						<p className="text-sm text-secondary dark:text-secondary-dark">
							This server does not take appeals yet. Set Appeals up and every ban DM can carry an appeals link.
						</p>
						<Link className="text-sm text-misc-accent hover:underline" href={`/dashboard/${guildId}/appeals/config`}>
							Set up Appeals
						</Link>
					</div>
				)}

				{OVERRIDE_SCOPES.map((scope) => (
					<div className="flex flex-col gap-2" key={scope}>
						<TextAreaField
							error={errors[scope]}
							id={`automoderator-notice-${scope.toLowerCase()}`}
							label={SCOPE_LABELS[scope]}
							maxLength={PUNISHMENT_NOTICE_MAX_LENGTH}
							onChange={(value) => updateField(scope, value)}
							placeholder={draft.DEFAULT.trim() ? 'Uses the general notice' : 'No notice'}
							rows={2}
							value={draft[scope]}
						/>
					</div>
				))}
			</div>

			<div>
				<Button className={buttonClass('primary')} isDisabled={!isDirty || setNotices.isPending} onPress={save}>
					{setNotices.isPending ? 'Saving...' : 'Save Changes'}
				</Button>
			</div>
		</div>
	);
}
