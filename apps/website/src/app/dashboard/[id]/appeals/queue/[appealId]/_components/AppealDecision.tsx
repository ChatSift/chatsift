'use client';

import { APPEAL_DECISION_REASON_MAX_LENGTH } from '@chatsift/core';
import { Button } from '@chatsift/web-core/components/Button';
import { ConfirmModal } from '@chatsift/web-core/components/ConfirmModal';
import { SegmentedControl } from '@chatsift/web-core/components/SegmentedControl';
import { TextAreaField } from '@chatsift/web-core/components/TextAreaField';
import { buttonClass } from '@chatsift/web-core/components/buttonStyles';
import { useState } from 'react';
import type { DecideAppealBody } from '@/api/routes/appeals';
import { useDecideAppeal } from '@/api/routes/appeals';

type Decision = DecideAppealBody['decision'];

const DECISION_OPTIONS = [
	{ value: 'approve', label: 'Approve' },
	{ value: 'deny', label: 'Deny' },
	// Third and last, matching the card's button order -- and secondary there for the same reason it is last
	// here: the two denials differ in who finds out, not in severity, and putting them side by side as equals is
	// how the wrong one gets picked.
	{ value: 'deny_silent', label: 'Deny silently' },
] as const satisfies readonly { label: string; value: Decision }[];

const CONFIRM_COPY: Record<Decision, { body: string; confirmLabel: string; title: string }> = {
	approve: {
		title: 'Approve this appeal?',
		body: 'This lifts their ban in this server straight away. Every decision is final -- there is no reopening an appeal.',
		confirmLabel: 'Approve and unban',
	},
	deny: {
		title: 'Deny this appeal?',
		body: 'They will see the decision, and the reason you wrote, on their appeal page. Every decision is final.',
		confirmLabel: 'Deny',
	},
	deny_silent: {
		title: 'Deny this appeal silently?',
		body: 'Their page will keep reading "under review", and it always will. Nobody on your team should contact them about this appeal afterwards. Every decision is final.',
		confirmLabel: 'Deny silently',
	},
};

/**
 * The dashboard's half of the three buttons on the mod-channel card (#232 P5, decision 1).
 *
 * Rendered only while the appeal is `PENDING`: every decision is terminal, so a decided appeal has nothing to
 * offer here and the detail view above shows what was decided instead. That mirrors the card, whose buttons stay
 * visible but disabled once a decision lands.
 */
export function AppealDecision({ guildId, appealId }: { readonly appealId: number; readonly guildId: string }) {
	const [decision, setDecision] = useState<Decision>('approve');
	const [reason, setReason] = useState('');
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const decide = useDecideAppeal(guildId, appealId);

	const silent = decision === 'deny_silent';
	// Required on an ordinary denial because it is the entire message the appellant receives, and a denial with
	// no reason is the thing every appeal system is criticised for. A silent denial has no reader waiting on it,
	// so an empty box there is a legitimate "no comment". The API enforces the same rule -- this only saves the
	// round trip.
	const needsReason = decision === 'deny' && !reason.trim().length;

	const copy = CONFIRM_COPY[decision];

	return (
		<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			{/* `items-start` is load-bearing: a `flex-col` stretches its children across the cross axis, so the
			    control's own `inline-flex` counts for nothing and the strip spans the whole card. */}
			<div className="flex flex-col items-start gap-2">
				<span className="text-sm font-medium text-primary dark:text-primary-dark" id="appeal-decision-label">
					Decide this appeal
				</span>
				{/* Wrapped rather than passing `setDecision` straight in: a `Dispatch<SetStateAction<...>>` parameter
				    also accepts an updater function, and `SegmentedControl` infers its value type from every
				    argument it is given -- including that one, which then fails its own `string | number | boolean`
				    constraint and silently widens to it. */}
				<SegmentedControl
					labelledBy="appeal-decision-label"
					onChange={(value) => setDecision(value)}
					options={DECISION_OPTIONS}
					value={decision}
				/>
			</div>

			{decision === 'approve' ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Approving lifts their ban in this server straight away.
				</p>
			) : (
				<TextAreaField
					helper={
						silent
							? 'Only your team ever sees this. The appellant is told nothing at all, now or later.'
							: 'The appellant will be shown this, so write it for them.'
					}
					id="appeal-decision-reason"
					label={silent ? 'Note for your team' : 'Reason'}
					maxLength={APPEAL_DECISION_REASON_MAX_LENGTH}
					onChange={setReason}
					rows={4}
					value={reason}
				/>
			)}

			{/* In its own row, the way `CaseDetail` puts its actions in one: a bare `Button` under a `flex-col`
			    stretches edge to edge and reads as a banner rather than as something to press. */}
			<div className="flex flex-wrap gap-2">
				<Button
					className={buttonClass(decision === 'approve' ? 'primary' : 'danger', 'sm')}
					isDisabled={needsReason}
					onPress={() => setIsConfirmOpen(true)}
				>
					{copy.confirmLabel}
				</Button>
			</div>

			<ConfirmModal
				confirmLabel={copy.confirmLabel}
				isDestructive={decision !== 'approve'}
				isOpen={isConfirmOpen}
				onConfirm={async () => {
					// `mutateAsync` rather than `mutate`: a rejection has to reach `ConfirmModal`, which leaves itself
					// open so the error banner appears over the thing it is about. Losing a race to the card in
					// Discord arrives here as that banner.
					await decide.mutateAsync({
						decision,
						// Omitted rather than sent empty on an approval -- the route refuses a reason there outright.
						...(decision === 'approve' ? {} : { reason: reason.trim() || null }),
					});
				}}
				onOpenChange={setIsConfirmOpen}
				title={copy.title}
			>
				{copy.body}
			</ConfirmModal>
		</div>
	);
}
