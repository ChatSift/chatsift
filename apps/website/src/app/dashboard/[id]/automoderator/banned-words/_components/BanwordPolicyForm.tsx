'use client';

import { BANWORD_POLICY_MAX_COUNT } from '@chatsift/core';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ACTION_LABELS, BANWORD_ACTIONS, DURATION_HELP, DURATION_RULE, parsePolicyDuration } from './policyDisplay';
import { mapApiErrorToFieldErrors } from '@/api/formErrors';
import type { AutomodRule, BanwordActionName, BanwordPolicy } from '@/api/routes/automoderatorBanwords';
import { useAutomodRules, useBanwordPolicies, useSetBanwordPolicy } from '@/api/routes/automoderatorBanwords';
import { Button } from '@/components/common/Button';
import { FormActions } from '@/components/common/FormActions';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { formatDurationInput } from '@/utils/duration';
import { cn } from '@/utils/util';

interface PolicyFormData {
	actionType: BanwordActionName;
	duration: string;
	keyword: string;
	ruleId: string;
	scope: 'keyword' | 'rule';
}

type PolicyFormErrors = Partial<Record<'actionType' | 'duration' | 'keyword' | 'ruleId', string>>;

const POLICY_FIELDS = ['ruleId', 'keyword', 'actionType', 'duration'] as const;

/**
 * How many keywords the picker renders before it insists on a filter. A rule holds up to a thousand, and
 * putting all of them in the DOM is both unusable and slow -- the filter is the interface at that size, not a
 * convenience on top of it.
 */
const KEYWORD_RENDER_LIMIT = 60;

function SegmentedButtons<TValue extends string>({
	labelledBy,
	onChange,
	options,
	value,
}: {
	readonly labelledBy: string;
	onChange(next: TValue): void;
	readonly options: readonly { disabled?: boolean; label: string; value: TValue }[];
	readonly value: TValue;
}) {
	return (
		<div
			aria-labelledby={labelledBy}
			className="inline-flex flex-wrap gap-1 rounded-md border border-on-secondary bg-on-tertiary p-1 dark:border-on-secondary-dark dark:bg-on-tertiary-dark"
			role="group"
		>
			{options.map((option) => (
				<Button
					aria-pressed={value === option.value}
					className={cn(
						'rounded px-4 py-1.5 text-sm font-medium transition-colors',
						value === option.value
							? 'bg-misc-accent text-accent shadow-sm'
							: 'text-secondary hover:bg-on-secondary/50 dark:text-secondary-dark dark:hover:bg-on-secondary-dark/50',
						option.disabled && 'cursor-not-allowed opacity-50',
					)}
					isDisabled={option.disabled ?? false}
					key={option.value}
					onPress={() => onChange(option.value)}
					type="button"
				>
					{option.label}
				</Button>
			))}
		</div>
	);
}

/**
 * A single keyword out of the rule's list, filtered rather than scrolled.
 *
 * Not one of `components/common`'s three selects: those all resolve a Discord entity by snowflake and render an
 * icon for it, and none of them survives a thousand plain strings in a dropdown. What this needs is a filter
 * over a list, which is a different control.
 */
function KeywordPicker({
	disabledKeywords,
	error,
	keywords,
	onChange,
	value,
}: {
	readonly disabledKeywords: ReadonlySet<string>;
	readonly error: string | undefined;
	readonly keywords: readonly string[];
	onChange(next: string): void;
	readonly value: string;
}) {
	const [filter, setFilter] = useState('');

	const normalized = filter.trim().toLowerCase();
	const matches =
		normalized.length === 0 ? keywords : keywords.filter((word) => word.toLowerCase().includes(normalized));
	const shown = matches.slice(0, KEYWORD_RENDER_LIMIT);

	return (
		<div className="flex flex-col gap-2">
			<TextField
				error={error}
				id="banword-keyword-filter"
				label="Keyword"
				onChange={setFilter}
				placeholder="Filter this rule's keywords"
				value={filter}
			/>

			{matches.length === 0 ? (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					No keyword in this rule matches that. Keywords are added in Server Settings → AutoMod.
				</p>
			) : (
				<div className="flex max-h-64 flex-wrap gap-1 overflow-y-auto rounded-md border border-on-secondary p-2 dark:border-on-secondary-dark">
					{shown.map((word) => {
						const alreadyUsed = disabledKeywords.has(word.toLowerCase()) && word !== value;

						return (
							<Button
								aria-pressed={value === word}
								className={cn(
									'rounded px-2 py-1 text-sm transition-colors',
									value === word
										? 'bg-misc-accent text-accent'
										: 'bg-on-tertiary text-primary hover:bg-on-secondary dark:bg-on-tertiary-dark dark:text-primary-dark dark:hover:bg-on-secondary-dark',
									alreadyUsed && 'cursor-not-allowed opacity-50',
								)}
								isDisabled={alreadyUsed}
								key={word}
								onPress={() => onChange(word)}
								type="button"
							>
								{word}
							</Button>
						);
					})}
				</div>
			)}

			{matches.length > shown.length && (
				<p className="text-sm text-secondary dark:text-secondary-dark">
					Showing {shown.length} of {matches.length} matches — narrow the filter to find the rest.
				</p>
			)}
		</div>
	);
}

interface BanwordPolicyFormProps {
	/**
	 * The policy being edited, or `undefined` when adding one. Its rule and keyword are its identity, so an
	 * edit changes only the punishment -- moving a policy to a different rule is adding one there and removing
	 * this one, and pretending otherwise would leave the original behind on save.
	 */
	readonly policy?: BanwordPolicy | undefined;
}

export function BanwordPolicyForm({ policy }: BanwordPolicyFormProps) {
	const router = useRouter();
	const { id: guildId } = useParams<{ id: string }>();

	const { data: rules, error: rulesError } = useAutomodRules(guildId);
	const { data: policies, error: policiesError } = useBanwordPolicies(guildId);
	const setPolicy = useSetBanwordPolicy(guildId);

	const [form, setForm] = useState<PolicyFormData>(() => ({
		ruleId: policy?.ruleId ?? '',
		scope: policy && policy.keyword !== null ? 'keyword' : 'rule',
		keyword: policy?.keyword ?? '',
		actionType: (policy?.actionType as BanwordActionName | undefined) ?? 'WARN',
		duration: formatDurationInput(policy?.durationSeconds ?? null),
	}));
	const [errors, setErrors] = useState<PolicyFormErrors>({});
	const [successMessage, setSuccessMessage] = useState<string | null>(null);

	const updateField = <TField extends keyof PolicyFormData>(field: TField, value: PolicyFormData[TField]) => {
		setForm((prev) => ({ ...prev, [field]: value }));
		setErrors((prev) => ({ ...prev, [field]: undefined }));
		setSuccessMessage(null);
	};

	const error = rulesError ?? policiesError;
	if (error) {
		return <UserErrorHandler error={error} />;
	}

	if (!rules || !policies) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	if (!rules.available) {
		return (
			<p
				className="mt-8 rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger"
				role="alert"
			>
				This server&apos;s AutoMod rules can&apos;t be read right now, so there is nothing to attach a policy to.
			</p>
		);
	}

	const availableRules: AutomodRule[] = rules.rules;
	const selectedRule = availableRules.find((rule) => rule.id === form.ruleId);

	// A rule whose keywords Discord will not enumerate -- a preset word list, or regex-only -- can only take a
	// whole-rule policy. Forcing the toggle rather than letting somebody pick "one keyword" and find an empty
	// list is the honest shape.
	const keywordScopeAvailable = (selectedRule?.keywords.length ?? 0) > 0;
	const scope = keywordScopeAvailable ? form.scope : 'rule';

	const siblingPolicies = policies.filter(
		(candidate) => candidate.ruleId === form.ruleId && candidate.id !== policy?.id,
	);
	const usedKeywords = new Set(
		siblingPolicies.flatMap((candidate) => (candidate.keyword === null ? [] : [candidate.keyword.toLowerCase()])),
	);
	const ruleLevelTaken = siblingPolicies.some((candidate) => candidate.keyword === null);

	// The owner's call: REPORT is offered when Discord's rule alerts rather than blocks. A blocked message never
	// existed, so a report card has nothing to link to -- the bot still files an account-level report if a rule
	// is switched to blocking after the fact, but there is no reason to let somebody configure that on purpose.
	const reportBlocked = selectedRule?.blocksMessages ?? false;
	const atLimit = !policy && policies.length >= BANWORD_POLICY_MAX_COUNT;

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		if (!selectedRule) {
			setErrors({ ruleId: 'Pick a rule first.' });
			return;
		}

		if (scope === 'rule' && ruleLevelTaken) {
			setErrors({ ruleId: 'This rule already has a whole-rule policy. Edit that one instead.' });
			return;
		}

		if (scope === 'keyword' && form.keyword.trim().length === 0) {
			setErrors({ keyword: 'Pick one of this rule’s keywords.' });
			return;
		}

		if (form.actionType === 'REPORT' && reportBlocked) {
			setErrors({
				actionType:
					'This rule blocks the message, so there would be nothing to report. Set it to alert in Discord first.',
			});
			return;
		}

		const parsed = parsePolicyDuration(form.duration, form.actionType);
		if (!parsed.ok) {
			setErrors({ duration: parsed.message });
			return;
		}

		setSuccessMessage(null);

		try {
			await setPolicy.mutateAsync({
				ruleId: form.ruleId,
				keyword: scope === 'rule' ? null : form.keyword,
				actionType: form.actionType,
				durationSeconds: parsed.seconds,
			});

			if (policy) {
				setErrors({});
				setSuccessMessage('Policy updated.');
				return;
			}

			router.replace(`/dashboard/${guildId}/automoderator/banned-words`);
		} catch (caughtError) {
			setErrors(
				mapApiErrorToFieldErrors(caughtError, {
					fields: POLICY_FIELDS,
					fallbackField: 'ruleId',
					entityName: 'policy',
					failureVerb: policy ? 'update' : 'add',
				}),
			);
		}
	};

	return (
		<form className="mt-8 max-w-2xl space-y-6" onSubmit={handleSubmit}>
			{successMessage && (
				<p
					className="rounded-lg border border-misc-accent bg-misc-accent/10 p-3 text-sm text-misc-accent"
					role="status"
				>
					{successMessage}
				</p>
			)}

			{atLimit && (
				<p className="rounded-lg border border-misc-danger bg-misc-danger/10 p-3 text-sm text-misc-danger" role="alert">
					This server already has {BANWORD_POLICY_MAX_COUNT} policies. Remove one before adding another.
				</p>
			)}

			<div className="space-y-4">
				<div>
					<span className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" id="banword-rule">
						AutoMod rule
					</span>

					{policy ? (
						// Fixed on edit: the rule and keyword are the row's identity, and changing them here would write
						// a second policy while leaving this one in place.
						<p className="text-primary dark:text-primary-dark">
							{selectedRule?.name ?? `Deleted rule (${form.ruleId})`}
						</p>
					) : (
						<SegmentedButtons
							labelledBy="banword-rule"
							onChange={(next) => {
								updateField('ruleId', next);
								updateField('keyword', '');
							}}
							options={availableRules.map((rule) => ({ value: rule.id, label: rule.name }))}
							value={form.ruleId}
						/>
					)}

					{errors.ruleId && <p className="mt-1 text-sm text-misc-danger">{errors.ruleId}</p>}
				</div>

				{selectedRule && !policy && (
					<div>
						<span className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" id="banword-scope">
							Applies to
						</span>
						<SegmentedButtons
							labelledBy="banword-scope"
							onChange={(next) => updateField('scope', next)}
							options={[
								{ value: 'rule' as const, label: 'Any hit on this rule', disabled: ruleLevelTaken },
								{ value: 'keyword' as const, label: 'One keyword', disabled: !keywordScopeAvailable },
							]}
							value={scope}
						/>
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							{keywordScopeAvailable
								? 'A keyword policy wins over a whole-rule one, so you can set the rule to warn and single out the words that should ban.'
								: 'Discord doesn’t expose the words behind this rule, so it can only take a whole-rule policy.'}
						</p>
					</div>
				)}

				{policy && policy.keyword !== null && (
					<div>
						<span className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark">Keyword</span>
						<code className="text-primary dark:text-primary-dark">{policy.keyword}</code>
					</div>
				)}

				{!policy && scope === 'keyword' && selectedRule && (
					<KeywordPicker
						disabledKeywords={usedKeywords}
						error={errors.keyword}
						keywords={selectedRule.keywords}
						onChange={(next) => updateField('keyword', next)}
						value={form.keyword}
					/>
				)}

				<div>
					<span className="mb-1 block text-sm font-medium text-secondary dark:text-secondary-dark" id="banword-action">
						Punishment
					</span>
					<SegmentedButtons
						labelledBy="banword-action"
						onChange={(next) => updateField('actionType', next)}
						options={BANWORD_ACTIONS.map((action) => ({
							value: action,
							label: ACTION_LABELS[action],
							disabled: action === 'REPORT' && reportBlocked,
						}))}
						value={form.actionType}
					/>
					{errors.actionType && <p className="mt-1 text-sm text-misc-danger">{errors.actionType}</p>}
					{reportBlocked && (
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
							Report isn&apos;t available because this rule blocks the message — there would be nothing for the report
							card to link to. Switch the rule to alert in Server Settings → AutoMod to use it.
						</p>
					)}
				</div>

				<TextField
					disabled={DURATION_RULE[form.actionType] === 'forbidden'}
					error={errors.duration}
					helper={
						<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">{DURATION_HELP[form.actionType]}</p>
					}
					id="banword-duration"
					label="Duration"
					onChange={(value) => updateField('duration', value)}
					placeholder={DURATION_RULE[form.actionType] === 'required' ? '1h' : '7d'}
					value={DURATION_RULE[form.actionType] === 'forbidden' ? '' : form.duration}
				/>
			</div>

			<FormActions
				isSubmitDisabled={atLimit || !selectedRule}
				isSubmitting={setPolicy.isPending}
				onCancel={() => router.back()}
				pendingLabel={policy ? 'Saving...' : 'Adding...'}
				submitLabel={policy ? 'Save Changes' : 'Add Policy'}
			/>
		</form>
	);
}

export function EditBanwordPolicyFormLoader() {
	const params = useParams<{ id: string; policyId: string }>();
	const { data: policies, isLoading, error } = useBanwordPolicies(params.id);

	if (error && policies === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading || !policies) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	const policy = policies.find((candidate) => String(candidate.id) === params.policyId);
	if (!policy) {
		return (
			<div className="py-12 text-center">
				<p className="text-xl text-secondary dark:text-secondary-dark">Policy not found</p>
			</div>
		);
	}

	return <BanwordPolicyForm policy={policy} />;
}
