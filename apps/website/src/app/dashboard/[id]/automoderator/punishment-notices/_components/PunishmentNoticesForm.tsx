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

	// Seeded once, then left alone: a background refetch must not clobber an unsaved edit. Same shape as every
	// other AutoModerator form here.
	useEffect(() => {
		if (data && draft === null) {
			const seeded = { ...EMPTY_DRAFT };
			for (const notice of data.notices) {
				seeded[notice.scope] = notice.content;
			}

			setDraft(seeded);
		}
	}, [data, draft]);

	if (error && data === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !data || draft === null) {
		return <Skeleton className="h-96 w-full rounded-lg" />;
	}

	// Pulled out of `data` so the closures below narrow it: `data.appealLink` inside a callback is only ever
	// `string | null` to TypeScript, and asserting it away is how a null slips into the DM as "null".
	const { appealLink } = data;

	const stored = { ...EMPTY_DRAFT };
	for (const notice of data.notices) {
		stored[notice.scope] = notice.content;
	}

	const isDirty = Object.keys(EMPTY_DRAFT).some(
		(key) => draft[key as PunishmentNoticeScope].trim() !== stored[key as PunishmentNoticeScope].trim(),
	);

	const updateField = (scope: PunishmentNoticeScope, value: string) => {
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

		updateField(
			'BAN',
			current ? `${current}\n\nYou can appeal this ban at ${link}` : `You can appeal this ban at ${link}`,
		);
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
						A notice here <strong>replaces</strong> the general one for that action rather than being added to it, so a
						ban can carry appeal instructions without every warning carrying them too. Leave one empty to use the
						general notice.
					</p>
				</div>

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

						{scope === 'BAN' &&
							(appealLink ? (
								<div className="flex flex-col gap-2 rounded-md border border-on-secondary p-3 dark:border-on-secondary-dark">
									<p className="text-sm text-secondary dark:text-secondary-dark">
										This server accepts ban appeals. A ban DM is the only place most people will ever see that, so put
										the link in it.
									</p>
									<AppealLinkCopy link={appealLink}>
										<Button
											className={buttonClass('primary', 'sm')}
											onPress={() => addAppealLink(appealLink)}
											type="button"
										>
											Add to this notice
										</Button>
									</AppealLinkCopy>
								</div>
							) : (
								<div className="flex flex-col gap-2 rounded-md border border-on-secondary p-3 dark:border-on-secondary-dark">
									<p className="text-sm text-secondary dark:text-secondary-dark">
										This server does not take appeals yet. Set Appeals up and every ban DM can carry a link where the
										person can make their case, answering your questions, in a channel your moderators already read -
										instead of them finding a staff member to DM, or not bothering.
									</p>
									<Link
										className="text-sm text-misc-accent hover:underline"
										href={`/dashboard/${guildId}/appeals/config`}
									>
										Set up Appeals
									</Link>
								</div>
							))}
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
