'use client';

import { automoderatorBanwordPoliciesChannel, BANWORD_POLICY_MAX_COUNT } from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ACTION_LABELS, describePolicy } from './policyDisplay';
import { queryKeys } from '@/api/queryClient';
import type { AutomodRule, BanwordActionName, BanwordPolicy } from '@/api/routes/automoderatorBanwords';
import { useAutomodRules, useBanwordPolicies, useDeleteBanwordPolicy } from '@/api/routes/automoderatorBanwords';
import { Button } from '@/components/common/Button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { SvgPlus } from '@/components/icons/SvgPlus';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

function Badge({
	children,
	tone,
}: {
	readonly children: React.ReactNode;
	readonly tone: 'accent' | 'muted' | 'warning';
}) {
	const toneClass = {
		accent: 'border-misc-accent text-misc-accent',
		warning: 'border-misc-warning text-misc-warning',
		muted: 'border-on-secondary text-secondary dark:border-on-secondary-dark dark:text-secondary-dark',
	}[tone];

	return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass}`}>{children}</span>;
}

function PolicyRow({ guildId, policy }: { readonly guildId: string; readonly policy: BanwordPolicy }) {
	const [isConfirmOpen, setIsConfirmOpen] = useState(false);
	const deletePolicy = useDeleteBanwordPolicy(guildId);

	const scopeLabel = policy.keyword === null ? 'Any hit on this rule' : policy.keyword;

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary p-3 dark:border-on-secondary-dark sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 flex-col">
				<span className="truncate text-sm font-medium text-primary dark:text-primary-dark">
					{policy.keyword === null ? scopeLabel : <code>{scopeLabel}</code>}
				</span>
				<span className="text-sm text-secondary dark:text-secondary-dark">
					{describePolicy(policy.actionType as BanwordActionName, policy.durationSeconds)}
				</span>
			</div>

			<div className="flex items-center gap-2">
				<Link
					className="flex h-fit items-center gap-2 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 text-primary hover:bg-on-tertiary active:bg-on-secondary dark:text-primary-dark dark:hover:bg-on-tertiary-dark dark:active:bg-on-secondary-dark"
					href={`/dashboard/${guildId}/automoderator/banned-words/${policy.id}`}
				>
					Edit
				</Link>
				<Button onPress={() => setIsConfirmOpen(true)}>
					<span className="text-misc-danger">Remove</span>
				</Button>
			</div>

			<ConfirmModal
				confirmLabel="Remove policy"
				isDestructive
				isOpen={isConfirmOpen}
				onConfirm={async () => {
					await deletePolicy.mutateAsync(policy.id);
				}}
				onOpenChange={setIsConfirmOpen}
				title="Remove this policy?"
			>
				Discord keeps blocking the message either way — this only stops AutoModerator responding to it. Cases this
				policy already produced stay exactly as they are.
			</ConfirmModal>
		</div>
	);
}

/**
 * One native rule and everything configured against it. The rule itself is Discord's; only the policies are
 * ours, which is why the header states the rule's behaviour rather than offering to change it.
 */
function RuleCard({
	guildId,
	policies,
	rule,
}: {
	readonly guildId: string;
	readonly policies: BanwordPolicy[];
	readonly rule: AutomodRule;
}) {
	// Rule-level first, matching the precedence the bot applies -- keyword beats rule, so the blanket policy is
	// what everything below it is an exception to.
	const ordered = [...policies].sort((left, right) => (left.keyword === null ? -1 : right.keyword === null ? 1 : 0));

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-lg font-semibold text-primary dark:text-primary-dark">{rule.name}</span>
				{!rule.enabled && <Badge tone="warning">Disabled in Discord</Badge>}
				<Badge tone="muted">{rule.blocksMessages ? 'Blocks messages' : 'Alerts only'}</Badge>
				{rule.keywords.length > 0 && <Badge tone="muted">{rule.keywords.length} keywords</Badge>}
				{rule.presets.length > 0 && <Badge tone="muted">Discord word list</Badge>}
				{rule.regexPatterns.length > 0 && <Badge tone="muted">{rule.regexPatterns.length} patterns</Badge>}
			</div>

			{!rule.enabled && (
				<p className="text-sm text-misc-warning">
					This rule is switched off in Discord, so it never matches anything and none of these policies can fire.
				</p>
			)}

			{rule.keywords.length === 0 && (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Discord doesn&apos;t expose the words behind its built-in lists or tell us which pattern matched in a way
					worth naming individually, so this rule takes a whole-rule policy rather than per-word ones.
				</p>
			)}

			{ordered.length === 0 ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					No policy. Hits on this rule are blocked by Discord and written to the filter log, and AutoModerator does
					nothing further.
				</p>
			) : (
				<div className="flex flex-col gap-2">
					{ordered.map((policy) => (
						<PolicyRow guildId={guildId} key={policy.id} policy={policy} />
					))}
				</div>
			)}
		</div>
	);
}

/**
 * Policies whose rule no longer exists on Discord's side.
 *
 * Shown rather than hidden or auto-deleted, deliberately. A rule can vanish because somebody deleted it, and it
 * can vanish because the bot momentarily could not read the list -- and quietly destroying a guild's configured
 * punishments on the strength of the second one is far worse than a row that says what happened and offers to
 * remove itself.
 */
function OrphanedPolicies({ guildId, policies }: { readonly guildId: string; readonly policies: BanwordPolicy[] }) {
	if (policies.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-misc-danger bg-card p-4 dark:bg-card-dark">
			<span className="text-lg font-semibold text-misc-danger">Policies with no rule</span>
			<p className="text-sm text-secondary dark:text-secondary-dark">
				These name an AutoMod rule this server no longer has, so nothing will ever trigger them. They are kept rather
				than deleted for you, in case the rule comes back or was removed by mistake.
			</p>
			<div className="flex flex-col gap-2">
				{policies.map((policy) => (
					<PolicyRow guildId={guildId} key={policy.id} policy={policy} />
				))}
			</div>
		</div>
	);
}

function AddPolicyCard({ disabled, guildId }: { readonly disabled: boolean; readonly guildId: string }) {
	if (disabled) {
		return (
			<div className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 text-center opacity-50 dark:border-on-secondary-dark dark:bg-card-dark">
				<span className="text-sm text-secondary dark:text-secondary-dark">
					You already have {BANWORD_POLICY_MAX_COUNT} policies.
				</span>
			</div>
		);
	}

	return (
		<Link
			className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark"
			href={`/dashboard/${guildId}/automoderator/banned-words/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Add Policy</span>
		</Link>
	);
}

/**
 * Banned words (P5, feature 01), which in the ported product is really "what to do about a native AutoMod hit".
 *
 * Discord does the matching and AutoModerator does the response, so this page reads the guild's rules and never
 * writes them -- keyword lists are edited in Server Settings, and everything here attaches to what is already
 * there. The upside of that split, and the reason it is worth the extra trip: a policy can only ever name a
 * keyword that exists, so the failure this feature is most prone to -- a punishment configured against a word
 * no rule contains, which fires nothing and errors nowhere -- cannot be expressed.
 */
export function BannedWordsList() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorBanwordPoliciesChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.banwordPolicies(guildId) });
	});

	const { data: rules, isLoading: isRulesLoading, error: rulesError } = useAutomodRules(guildId);
	const { data: policies, isLoading: isPoliciesLoading, error: policiesError } = useBanwordPolicies(guildId);

	const error = rulesError ?? policiesError;
	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (isRulesLoading || isPoliciesLoading || !rules || !policies) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-24 w-full rounded-lg" />
				<Skeleton className="h-40 w-full rounded-lg" />
			</div>
		);
	}

	if (!rules.available) {
		return (
			<EmptyState
				icon={<SvgAutoModerator height={28} width={28} />}
				subtitle={
					rules.reason === 'missing-permission'
						? 'Reading a server’s AutoMod rules needs the Manage Server permission, which AutoModerator doesn’t currently have here. Grant it and reload — nothing else about this feature needs it, and AutoModerator never edits your rules.'
						: 'AutoModerator can’t see this server right now. If it was just removed, re-invite it and reload.'
				}
				title="Can't read this server's AutoMod rules"
			/>
		);
	}

	const ruleIds = new Set(rules.rules.map((rule) => rule.id));
	const orphaned = policies.filter((policy) => !ruleIds.has(policy.ruleId));

	if (rules.rules.length === 0) {
		return (
			<div className="flex flex-col gap-4">
				<EmptyState
					icon={<SvgAutoModerator height={28} width={28} />}
					subtitle="AutoModerator responds to Discord's own AutoMod, so it needs at least one keyword rule to respond to. Create one in Server Settings → AutoMod, then come back and say what should happen when it catches somebody."
					title="This server has no AutoMod rules"
				/>
				<OrphanedPolicies guildId={guildId} policies={orphaned} />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<p className="text-sm text-secondary dark:text-secondary-dark">
				Discord&apos;s AutoMod decides what counts as a banned word and blocks the message. This page decides what
				happens to the person who sent it. Add or remove keywords in Server Settings → AutoMod; everything here attaches
				to the rules already there. A rule with no policy still shows up in the filter log.
			</p>

			<AddPolicyCard disabled={policies.length >= BANWORD_POLICY_MAX_COUNT} guildId={guildId} />

			{rules.rules.map((rule) => (
				<RuleCard
					guildId={guildId}
					key={rule.id}
					policies={policies.filter((policy) => policy.ruleId === rule.id)}
					rule={rule}
				/>
			))}

			<OrphanedPolicies guildId={guildId} policies={orphaned} />
		</div>
	);
}
