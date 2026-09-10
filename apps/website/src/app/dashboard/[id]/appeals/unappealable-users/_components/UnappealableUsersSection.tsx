'use client';

import { createUnappealableUserBodySchema } from '@chatsift/api/appeals-schemas';
import { appealsUnappealableUsersChannel } from '@chatsift/core';
import { APIError } from '@chatsift/web-core/api/error';
import { Button } from '@chatsift/web-core/components/Button';
import { EmptyState } from '@chatsift/web-core/components/EmptyState';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { SnowflakeInput } from '@chatsift/web-core/components/SnowflakeInput';
import { TextField } from '@chatsift/web-core/components/TextField';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { UnappealableUserCard } from './UnappealableUserCard';
import { queryKeys } from '@/api/queryClient';
import { useSetUnappealableUser, useUnappealableUsers } from '@/api/routes/appeals';
import { SvgAppeals } from '@/components/icons/SvgAppeals';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

const REASON_MAX_LENGTH = 1_024;

// `| undefined` spelled out: `exactOptionalPropertyTypes` is on, so a plain `?:` would reject clearing a field
// by writing `undefined` back into it.
interface AddFormErrors {
	reason?: string | undefined;
	userId?: string | undefined;
}

/**
 * The manual half of decision 8 -- accounts a moderator has decided may never appeal, whatever the cooldown
 * says. Pattern matching against the ban reason is the automatic half and lands in P8.
 *
 * Keyed on a raw id rather than a picker, unlike every other user-facing list in the dashboard: everybody
 * eligible for this list is banned, so they are not a member the guild's roster could offer.
 */
export function UnappealableUsersSection() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	const [userId, setUserId] = useState('');
	const [reason, setReason] = useState('');
	const [errors, setErrors] = useState<AddFormErrors>({});
	const [addError, setAddError] = useState<string | null>(null);

	useRealtimeInvalidate(appealsUnappealableUsersChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.appeals.unappealableUsers(guildId) });
	});

	const { data: users, isLoading, error } = useUnappealableUsers(guildId);
	const setUnappealable = useSetUnappealableUser(guildId);

	// See `BlocksList.tsx`: a background refetch failure keeps the previously-cached list around, and that
	// stale-but-present data should keep rendering rather than being replaced by the full error state.
	if (error && users === undefined) {
		return <UserErrorHandler error={error} />;
	}

	const handleAdd = async () => {
		const parsed = createUnappealableUserBodySchema.safeParse({
			userId: userId.trim(),
			reason: reason.trim() || null,
		});

		if (!parsed.success) {
			const next: AddFormErrors = {};
			for (const issue of parsed.error.issues) {
				const [field] = issue.path;
				if (field === 'userId') {
					next.userId ??= 'Enter a valid Discord user id.';
				} else if (field === 'reason') {
					next.reason ??= issue.message;
				}
			}

			setErrors(next);
			return;
		}

		setErrors({});
		setAddError(null);

		try {
			await setUnappealable.mutateAsync(parsed.data);
			setUserId('');
			setReason('');
		} catch (caughtError) {
			setAddError(caughtError instanceof APIError ? caughtError.message : 'Failed to add. Please try again.');
		}
	};

	return (
		<div className="space-y-6">
			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-6 dark:border-on-secondary-dark dark:bg-card-dark">
				<SnowflakeInput
					error={errors.userId}
					id="appeals-unappealable-user-id"
					label="User ID"
					onChange={(value) => {
						setUserId(value);
						setErrors((prev) => ({ ...prev, userId: undefined }));
					}}
					required
					value={userId}
				/>

				<TextField
					error={errors.reason}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">Optional, only shown to moderators.</p>
					}
					id="appeals-unappealable-reason"
					label="Reason"
					maxLength={REASON_MAX_LENGTH}
					onChange={(value) => {
						setReason(value);
						setErrors((prev) => ({ ...prev, reason: undefined }));
					}}
					placeholder="Ban evasion"
					trailing={
						<Button
							className={buttonClass('primary', 'field')}
							isDisabled={userId.trim() === '' || setUnappealable.isPending}
							onPress={handleAdd}
							type="button"
						>
							{setUnappealable.isPending ? 'Adding...' : 'Add'}
						</Button>
					}
					value={reason}
				/>

				{addError && (
					<p className="text-sm text-misc-danger" role="alert">
						{addError}
					</p>
				)}
			</div>

			{isLoading || !users ? (
				<div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
					<Skeleton className="h-40 w-full rounded-lg" />
					<Skeleton className="h-40 w-full rounded-lg" />
				</div>
			) : users!.length === 0 ? (
				<EmptyState
					icon={<SvgAppeals height={28} width={28} />}
					subtitle="Everybody banned here can file an appeal, subject to the cooldown. Add the accounts that shouldn't be able to."
					title="Nobody is unappealable"
				/>
			) : (
				<div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-3">
					{users!.map((entry) => (
						<UnappealableUserCard
							entry={entry}
							guildId={guildId}
							key={typeof entry.user === 'string' ? entry.user : entry.user.id}
						/>
					))}
				</div>
			)}
		</div>
	);
}
