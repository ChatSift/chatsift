'use client';

import {
	ALLOWED_INVITE_MAX_COUNT,
	automoderatorAllowedInvitesChannel,
	automoderatorConfigChannel,
} from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FilterToggle } from '../../_components/FilterToggle';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import {
	useAutomoderatorAllowedInvites,
	useCreateAutomoderatorAllowedInvite,
	useDeleteAutomoderatorAllowedInvite,
} from '@/api/routes/automoderatorFilters';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { buttonClass } from '@/components/common/buttonStyles';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

/**
 * The invite filter (P5b, feature 03): delete messages advertising other Discord servers.
 *
 * Entries are *servers*, not invite links -- the API resolves whatever is pasted and stores the server behind
 * it, so every invite to an allowed server is allowed, including ones minted later and the vanity URL. The copy
 * says so, because "I allowed the link and it still got deleted" is the confusion the code-keyed version of
 * this feature produced for years.
 */
export function InviteFilterForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorAllowedInvitesChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.allowedInvites(guildId) });
	});

	useRealtimeInvalidate(automoderatorConfigChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.config(guildId) });
	});

	const { data: config, error: configError } = useAutomoderatorConfig(guildId);
	const { data: allowed, isLoading, error } = useAutomoderatorAllowedInvites(guildId);
	const updateConfig = useUpdateAutomoderatorConfig(guildId);
	const createAllowed = useCreateAutomoderatorAllowedInvite(guildId);
	const deleteAllowed = useDeleteAutomoderatorAllowedInvite(guildId);

	const [draft, setDraft] = useState('');
	const [addError, setAddError] = useState<string | null>(null);

	if (error ?? configError) {
		return <UserErrorHandler error={(error ?? configError)!} />;
	}

	if (isLoading || !allowed || !config) {
		return <Skeleton className="h-64 w-full rounded-lg" />;
	}

	const atLimit = allowed.length >= ALLOWED_INVITE_MAX_COUNT;

	return (
		<div className="flex flex-col gap-4">
			<FilterToggle
				description="When on, any message containing an invite to a server that isn't allowed below is deleted, and the member is told why in a DM. Invites to this server are always allowed and don't need listing."
				isEnabled={config.useInviteFilters}
				label="Invite filter"
				onChange={async (useInviteFilters) => updateConfig.mutateAsync({ useInviteFilters })}
			/>

			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<div>
					<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Allowed servers</h3>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Paste an invite and the server behind it is allowed — every invite to that server, including ones created
						later and its vanity URL. The invite has to be live at the moment you add it, since that is how the server
						is identified.
					</p>
				</div>

				{allowed.length === 0 ? (
					<EmptyState
						icon={<SvgAutoModerator height={28} width={28} />}
						subtitle="No other servers are allowed. Add your partner or affiliate servers here if members should be able to link them."
						title="No allowed servers"
					/>
				) : (
					<div className="flex flex-col gap-2">
						{allowed.map((entry) => (
							<AllowedRow
								allowedGuildId={entry.allowedGuildId}
								isPending={deleteAllowed.isPending}
								key={entry.allowedGuildId}
								name={entry.name}
								onRemove={async () => deleteAllowed.mutateAsync(entry.allowedGuildId)}
							/>
						))}
					</div>
				)}

				<div className="border-t border-on-secondary pt-4 dark:border-on-secondary-dark">
					<TextField
						error={addError ?? undefined}
						helper="An invite link or code — discord.gg/example, or just example."
						id="automoderator-allowed-invite-new"
						label="Allow a server by invite"
						maxLength={200}
						onChange={(value) => {
							setDraft(value);
							setAddError(null);
						}}
						placeholder="discord.gg/example"
						trailing={
							<Button
								className={buttonClass('primary', 'field')}
								isDisabled={atLimit || draft.trim() === '' || createAllowed.isPending}
								onPress={async () => {
									try {
										await createAllowed.mutateAsync({ invite: draft });
										setDraft('');
									} catch (caughtError) {
										setAddError(caughtError instanceof APIError ? caughtError.message : 'Failed to add.');
									}
								}}
							>
								{createAllowed.isPending ? 'Checking...' : 'Add'}
							</Button>
						}
						value={draft}
					/>
				</div>

				{atLimit && (
					<p className="text-sm text-misc-warning dark:text-misc-warning-dark">
						You already have {ALLOWED_INVITE_MAX_COUNT} allowed servers, which is the limit.
					</p>
				)}
			</div>
		</div>
	);
}

function AllowedRow({
	allowedGuildId,
	isPending,
	name,
	onRemove,
}: {
	readonly allowedGuildId: string;
	readonly isPending: boolean;
	readonly name: string;
	onRemove(): Promise<unknown>;
}) {
	const [error, setError] = useState<string | null>(null);

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary p-3 dark:border-on-secondary-dark sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 flex-col">
				<span className="truncate text-sm text-primary dark:text-primary-dark">{name}</span>
				{/* The name is a snapshot from when it was added and nothing can refresh it -- AutoModerator is not in
				    that server. The id is what actually matches, so it is shown rather than hidden behind a name that
				    may have changed since. */}
				<span className="truncate text-xs text-secondary dark:text-secondary-dark">
					{allowedGuildId} · name as of when it was added
				</span>
			</div>

			<div className="flex items-center gap-2">
				{error && <span className="text-sm text-misc-danger">{error}</span>}
				<Button
					className={buttonClass('secondary', 'sm')}
					isDisabled={isPending}
					onPress={async () => {
						try {
							await onRemove();
						} catch (caughtError) {
							setError(caughtError instanceof APIError ? caughtError.message : 'Failed to remove.');
						}
					}}
				>
					Remove
				</Button>
			</div>
		</div>
	);
}
