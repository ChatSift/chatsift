'use client';

import {
	ALLOWED_URL_MAX_COUNT,
	ALLOWED_URL_MAX_LENGTH,
	automoderatorAllowedUrlsChannel,
	automoderatorConfigChannel,
	normalizeAllowedDomain,
} from '@chatsift/core';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FilterToggle } from '../../_components/FilterToggle';
import { APIError } from '@/api/error';
import { queryKeys } from '@/api/queryClient';
import { useAutomoderatorConfig, useUpdateAutomoderatorConfig } from '@/api/routes/automoderator';
import {
	useAutomoderatorAllowedUrls,
	useCreateAutomoderatorAllowedUrl,
	useDeleteAutomoderatorAllowedUrl,
} from '@/api/routes/automoderatorFilters';
import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { TextField } from '@/components/common/TextField';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';

/**
 * The URL filter (P5b, feature 02): delete messages linking anywhere not on the allowlist.
 *
 * The empty-allowlist state is the one worth being explicit about, because it is not an unconfigured state --
 * it means "no links at all", which is a setting some servers genuinely want. The copy says so rather than
 * showing a neutral empty list next to a switch that is quietly deleting every link posted.
 */
export function UrlFilterForm() {
	const { id: guildId } = useParams<{ id: string }>();
	const queryClient = useQueryClient();

	useRealtimeInvalidate(automoderatorAllowedUrlsChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.allowedUrls(guildId) });
	});

	useRealtimeInvalidate(automoderatorConfigChannel(guildId), () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.automoderator.config(guildId) });
	});

	const { data: config, error: configError } = useAutomoderatorConfig(guildId);
	const { data: allowed, isLoading, error } = useAutomoderatorAllowedUrls(guildId);
	const updateConfig = useUpdateAutomoderatorConfig(guildId);
	const createAllowed = useCreateAutomoderatorAllowedUrl(guildId);
	const deleteAllowed = useDeleteAutomoderatorAllowedUrl(guildId);

	const [draft, setDraft] = useState('');
	const [addError, setAddError] = useState<string | null>(null);

	if (error ?? configError) {
		return <UserErrorHandler error={(error ?? configError)!} />;
	}

	if (isLoading || !allowed || !config) {
		return <Skeleton className="h-64 w-full rounded-lg" />;
	}

	// The exact string the API will store, computed with the same function the API and the bot use. Shown live
	// so nobody is surprised that pasting a full article URL allowlists the whole site.
	const normalized = normalizeAllowedDomain(draft);
	const atLimit = allowed.length >= ALLOWED_URL_MAX_COUNT;

	return (
		<div className="flex flex-col gap-4">
			<FilterToggle
				description="When on, any message containing a link to a domain that isn't allowed below is deleted, and the member is told why in a DM. Only links with a full https:// or http:// prefix are matched — that's what keeps ordinary sentences from being treated as links."
				isEnabled={config.useUrlFilters}
				label="URL filter"
				onChange={async (useUrlFilters) => updateConfig.mutateAsync({ useUrlFilters })}
			/>

			<div className="flex flex-col gap-4 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
				<div>
					<h3 className="text-sm font-medium text-primary dark:text-primary-dark">Allowed domains</h3>
					<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
						Allowing a domain also allows everything under it — <code>example.com</code> covers{' '}
						<code>www.example.com</code> and <code>cdn.example.com</code>. Invites to Discord servers are handled
						separately by the invite filter.
					</p>
				</div>

				{allowed.length === 0 ? (
					<EmptyState
						icon={<SvgAutoModerator height={28} width={28} />}
						subtitle={
							config.useUrlFilters
								? 'Every link posted in this server is currently deleted. If that is what you want, leave this empty — otherwise add the sites your members are meant to be able to share.'
								: 'Add the sites your members are meant to be able to share before turning the filter on.'
						}
						title="No allowed domains"
					/>
				) : (
					<div className="flex flex-col gap-2">
						{allowed.map((entry) => (
							<AllowedRow
								domain={entry.domain}
								isPending={deleteAllowed.isPending}
								key={entry.domain}
								onRemove={async () => deleteAllowed.mutateAsync(entry.domain)}
							/>
						))}
					</div>
				)}

				<div className="flex flex-col gap-2 border-t border-on-secondary pt-4 dark:border-on-secondary-dark sm:flex-row sm:items-end">
					<div className="flex-1">
						<TextField
							error={addError ?? undefined}
							helper={
								normalized === null
									? 'A domain, or a link to one — example.com, or https://example.com/page.'
									: `Will be saved as ${normalized}`
							}
							id="automoderator-allowed-url-new"
							label="Add a domain"
							maxLength={ALLOWED_URL_MAX_LENGTH}
							onChange={(value) => {
								setDraft(value);
								setAddError(null);
							}}
							placeholder="example.com"
							value={draft}
						/>
					</div>

					<Button
						className="rounded-md bg-misc-accent px-3 py-2.5 text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
						isDisabled={atLimit || normalized === null || createAllowed.isPending}
						onPress={async () => {
							try {
								await createAllowed.mutateAsync({ domain: draft });
								setDraft('');
							} catch (caughtError) {
								setAddError(caughtError instanceof APIError ? caughtError.message : 'Failed to add.');
							}
						}}
					>
						{createAllowed.isPending ? 'Adding...' : 'Add'}
					</Button>
				</div>

				{atLimit && (
					<p className="text-sm text-misc-warning dark:text-misc-warning-dark">
						You already have {ALLOWED_URL_MAX_COUNT} allowed domains. Allow a parent domain instead of listing its
						subdomains one by one.
					</p>
				)}
			</div>
		</div>
	);
}

function AllowedRow({
	domain,
	isPending,
	onRemove,
}: {
	readonly domain: string;
	readonly isPending: boolean;
	onRemove(): Promise<unknown>;
}) {
	const [error, setError] = useState<string | null>(null);

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-on-secondary p-3 dark:border-on-secondary-dark sm:flex-row sm:items-center sm:justify-between">
			<span className="truncate text-sm text-primary dark:text-primary-dark">{domain}</span>

			<div className="flex items-center gap-2">
				{error && <span className="text-sm text-misc-danger">{error}</span>}
				<Button
					className="rounded-md bg-on-tertiary px-3 py-2 text-primary transition-colors hover:bg-on-secondary dark:bg-on-tertiary-dark dark:text-primary-dark dark:hover:bg-on-secondary-dark"
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
