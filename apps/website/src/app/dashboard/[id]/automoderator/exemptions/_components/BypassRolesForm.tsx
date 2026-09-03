'use client';

import { automoderatorBypassRolesChannel, BYPASS_ROLE_MAX_COUNT } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import {
	useAutomoderatorBypassRoles,
	useDeleteAutomoderatorBypassRole,
	useSetAutomoderatorBypassRole,
} from '@/api/routes/automoderatorBypassRoles';
import type { GuildRoleInfo } from '@/api/routes/guilds';
import { useGuildInfo } from '@/api/routes/guilds';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { RoleSelect } from '@/components/common/RoleSelect';
import { Skeleton } from '@/components/common/Skeleton';
import { buttonClass } from '@/components/common/buttonStyles';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { roleColor } from '@/utils/util';

function BypassRow({
	guildId,
	isRolesLoading,
	role,
	roleId,
}: {
	readonly guildId: string;
	readonly isRolesLoading: boolean;
	readonly role: GuildRoleInfo | undefined;
	readonly roleId: string;
}) {
	const deleteBypassRole = useDeleteAutomoderatorBypassRole(guildId);
	const [error, setError] = useState<string | null>(null);

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary p-3 dark:border-on-secondary-dark sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-center gap-2">
				{role ? (
					<>
						<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: roleColor(role.color) }} />
						<span className="truncate text-sm text-primary dark:text-primary-dark">{role.name}</span>
					</>
				) : (
					// A config row outliving the role it names is the bug class this dashboard keeps hitting, so it is
					// stated rather than rendered as a blank -- and the row stays removable, which is the whole point of
					// saying so.
					<span className="truncate text-sm text-misc-danger">
						{isRolesLoading ? 'Loading…' : `Deleted role (${roleId})`}
					</span>
				)}
			</div>

			<div className="flex items-center gap-2">
				{error && <span className="text-sm text-misc-danger">{error}</span>}
				<Button
					className={buttonClass('secondary', 'sm')}
					isDisabled={deleteBypassRole.isPending}
					onPress={async () => {
						try {
							await deleteBypassRole.mutateAsync(roleId);
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

/**
 * Roles whose members trip the filters but are never punished for it (P5, feature 10). The match and the log
 * entry still happen -- this only suppresses the action, which is what separates it from Discord's own per-rule
 * exempt roles.
 */
export function BypassRolesForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorBypassRolesChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.bypassRoles(guildId) });
	});

	const { data: bypassRoles, isLoading, error } = useAutomoderatorBypassRoles(guildId);
	const { data: guildInfo, isLoading: isGuildInfoLoading } = useGuildInfo(guildId, 'AUTOMODERATOR');
	const setBypassRole = useSetAutomoderatorBypassRole(guildId);

	const [draft, setDraft] = useState('');
	const [addError, setAddError] = useState<string | null>(null);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !bypassRoles) {
		return <Skeleton className="h-40 w-full rounded-lg" />;
	}

	const bypassIds = bypassRoles.map((entry) => entry.roleId);
	const atLimit = bypassRoles.length >= BYPASS_ROLE_MAX_COUNT;

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm text-secondary dark:text-secondary-dark">
				Members holding these roles still trip the filters and still show up in the filter log — they just don't get
				punished for it. This is not the same as Discord's own exempt roles on a rule, which stop the match happening at
				all, so nothing is logged either. Use Discord's when you don't want the noise, and these when you want the
				record.
			</p>

			{bypassRoles.length === 0 ? (
				<EmptyState icon={<SvgAutoModerator height={28} width={28} />} title="No bypass roles" />
			) : (
				<div className="flex flex-col gap-2">
					{bypassRoles.map((entry) => (
						<BypassRow
							guildId={guildId}
							isRolesLoading={isGuildInfoLoading}
							key={entry.roleId}
							role={guildInfo?.roles.find((role) => role.id === entry.roleId)}
							roleId={entry.roleId}
						/>
					))}
				</div>
			)}

			<div className="flex flex-col gap-2 border-t border-on-secondary pt-4 dark:border-on-secondary-dark sm:flex-row sm:items-end">
				<div className="flex-1">
					<RoleSelect
						// Roles already bypassing stay listed but unpickable, so the picker explains itself instead of
						// looking like it lost half the server.
						disabledIds={bypassIds}
						disabledReason="already bypassing"
						error={addError ?? undefined}
						isLoading={isGuildInfoLoading}
						label="Add a role"
						onChange={(value) => {
							setDraft(value ?? '');
							setAddError(null);
						}}
						roles={guildInfo?.roles ?? []}
						selectedId="automoderator-bypass-role-new"
						value={draft}
					/>
				</div>

				<Button
					className={buttonClass('primary', 'sm')}
					isDisabled={atLimit || draft === '' || setBypassRole.isPending}
					onPress={async () => {
						try {
							await setBypassRole.mutateAsync(draft);
							// Cleared on success, not only when the picker changes: a retry that works has to take the previous
							// failure's message off the field with it.
							setAddError(null);
							setDraft('');
						} catch (caughtError) {
							setAddError(caughtError instanceof APIError ? caughtError.message : 'Failed to add.');
						}
					}}
				>
					{setBypassRole.isPending ? 'Adding...' : 'Add'}
				</Button>
			</div>

			{atLimit && (
				<p className="text-sm text-misc-warning dark:text-misc-warning-dark">
					You already have {BYPASS_ROLE_MAX_COUNT} bypass roles. Remove one, or give the roles you want covered a single
					shared role to list here instead.
				</p>
			)}
		</div>
	);
}
