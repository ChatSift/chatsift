'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ACTION_LABELS, ACTION_PILL_CLASSES, caseUserLabel } from '../../_components/caseDisplay';
import type { GetAutomoderatorCaseResult } from '@/api/routes/automoderatorCases';
import {
	useAutomoderatorCase,
	useAutomoderatorCases,
	useDeleteAutomoderatorCase,
	useUpdateAutomoderatorCase,
} from '@/api/routes/automoderatorCases';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Heading } from '@/components/common/Heading';
import { Skeleton } from '@/components/common/Skeleton';
import { TextAreaField } from '@/components/common/TextAreaField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { cn, formatDate } from '@/utils/util';

const REASON_MAX_LENGTH = 400;

function Field({ label, children }: { readonly children: React.ReactNode; readonly label: string }) {
	return (
		<div className="flex flex-col gap-1">
			<p className="text-xs font-medium uppercase tracking-wide text-secondary dark:text-secondary-dark">{label}</p>
			<div className="text-sm text-primary dark:text-primary-dark">{children}</div>
		</div>
	);
}

function OtherCases({
	guildId,
	modCase,
}: {
	readonly guildId: string;
	readonly modCase: GetAutomoderatorCaseResult['case'];
}) {
	const { data } = useAutomoderatorCases(guildId, { includePardoned: false, targetId: modCase.targetId });
	const others = (data?.pages.flatMap((page) => page.cases) ?? []).filter((other) => other.id !== modCase.id);

	if (others.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<p className="text-sm font-medium text-primary dark:text-primary-dark">Other cases for this user</p>
			<div className="flex flex-col gap-1">
				{others.slice(0, 10).map((other) => (
					<Link
						className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-on-tertiary dark:hover:bg-on-tertiary-dark"
						href={`/dashboard/${guildId}/automoderator/cases/${other.caseId}`}
						key={other.id}
					>
						<span className="text-secondary dark:text-secondary-dark">#{other.caseId}</span>
						<span
							className={cn(
								'rounded-full px-2 py-0.5 text-xs font-medium',
								ACTION_PILL_CLASSES[other.actionType] ?? 'bg-on-tertiary text-secondary',
							)}
						>
							{ACTION_LABELS[other.actionType] ?? other.actionType}
						</span>
					</Link>
				))}
			</div>

			<Link
				className="text-sm text-misc-accent hover:underline"
				href={`/dashboard/${guildId}/automoderator/cases?search=${modCase.targetId}`}
			>
				See all cases for this user
			</Link>
		</div>
	);
}

export function CaseDetail() {
	const { id: guildId, caseId: caseIdParam } = useParams<{ caseId: string; id: string }>();
	const caseId = Number(caseIdParam);
	const router = useRouter();

	const { data, isLoading, error } = useAutomoderatorCase(guildId, caseId);
	const updateCase = useUpdateAutomoderatorCase(guildId, caseId);
	const deleteCase = useDeleteAutomoderatorCase(guildId);

	const [reason, setReason] = useState<string | null>(null);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);

	useEffect(() => {
		if (data && reason === null) {
			setReason(data.case.reason ?? '');
		}
	}, [data, reason]);

	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !data) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-10 w-64 rounded-lg" />
				<Skeleton className="h-64 w-full rounded-lg" />
			</div>
		);
	}

	const { case: modCase, reference } = data;
	const isWarn = modCase.actionType === 'WARN';

	return (
		<div className="flex flex-col gap-6 lg:flex-row">
			<div className="flex flex-1 flex-col gap-6">
				<Heading
					subtitle={`${caseUserLabel(modCase.target, modCase.targetTag)} (${modCase.targetId})`}
					title={`Case #${modCase.caseId}`}
					trailing={
						<span
							className={cn(
								'rounded-full px-2.5 py-1 text-xs font-medium',
								ACTION_PILL_CLASSES[modCase.actionType] ?? 'bg-on-tertiary text-secondary',
							)}
						>
							{ACTION_LABELS[modCase.actionType] ?? modCase.actionType}
						</span>
					}
				/>

				<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
					<TextAreaField
						helper="Rewrites the reason on the mod log embed too."
						id="case-reason"
						label="Reason"
						maxLength={REASON_MAX_LENGTH}
						onChange={setReason}
						placeholder="No reason given"
						value={reason ?? ''}
					/>

					<div className="flex flex-wrap gap-2">
						<Button
							className="rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90"
							isDisabled={updateCase.isPending || (reason ?? '') === (modCase.reason ?? '')}
							onPress={async () => {
								await updateCase.mutateAsync({ reason: reason?.trim() ? reason.trim() : null });
							}}
						>
							{updateCase.isPending ? 'Saving...' : 'Save reason'}
						</Button>

						{/* Pardoning is warn-only, which is what the API enforces too: it's the thing that stops a
							warn counting toward the escalation ladder, and nothing else is counted. */}
						{isWarn && (
							<Button
								className="rounded-md bg-on-tertiary px-3 py-2.5 text-primary transition-colors hover:bg-on-secondary dark:bg-on-tertiary-dark dark:text-primary-dark dark:hover:bg-on-secondary-dark"
								isDisabled={updateCase.isPending}
								onPress={async () => {
									await updateCase.mutateAsync({ pardoned: !modCase.pardonedBy });
								}}
							>
								{modCase.pardonedBy ? 'Un-pardon' : 'Pardon'}
							</Button>
						)}

						<Button
							className="rounded-md bg-misc-danger/10 px-3 py-2.5 text-misc-danger transition-opacity hover:opacity-90"
							onPress={() => setIsDeleteOpen(true)}
						>
							Delete
						</Button>
					</div>
				</div>
			</div>

			<div className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
				<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
					<Field label="Moderator">{modCase.modTag ? `${modCase.modTag} (${modCase.modId})` : 'Not attributed'}</Field>
					<Field label="Created">{formatDate(new Date(modCase.createdAt))}</Field>
					{modCase.expiresAt && <Field label="Expires">{formatDate(new Date(modCase.expiresAt))}</Field>}
					{reference && (
						<Field label="References">
							<Link
								className="text-misc-accent hover:underline"
								href={`/dashboard/${guildId}/automoderator/cases/${reference.caseId}`}
							>
								Case #{reference.caseId}
							</Link>
						</Field>
					)}
					{modCase.pardonedBy && <Field label="Pardoned by">{modCase.pardonedBy}</Field>}
					{modCase.dryRun && <Field label="Dry run">This case was recorded, but no Discord action was taken.</Field>}
				</div>

				<OtherCases guildId={guildId} modCase={modCase} />
			</div>

			<ConfirmModal
				confirmLabel="Delete case"
				isDestructive
				isOpen={isDeleteOpen}
				onConfirm={async () => {
					await deleteCase.mutateAsync(modCase.caseId);
					router.push(`/dashboard/${guildId}/automoderator/cases`);
				}}
				onOpenChange={setIsDeleteOpen}
				title={`Delete case #${modCase.caseId}?`}
			>
				This removes the case from the bot&apos;s records and from this user&apos;s history. The mod log message stays
				where it is.
			</ConfirmModal>
		</div>
	);
}
