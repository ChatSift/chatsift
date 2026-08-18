'use client';

import { useParams } from 'next/navigation';
import { ReportPromptForm } from '../../_components/ReportPromptForm';
import { useAutomoderatorReportPrompts } from '@/api/routes/automoderatorReports';
import { EmptyState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/common/Skeleton';
import { SvgAutoModerator } from '@/components/icons/SvgAutoModerator';
import { UserErrorHandler } from '@/components/user/UserErrorHandler';

/**
 * Resolves the prompt out of the guild's list rather than fetching one by id -- there is no single-prompt
 * route, because a guild has a handful of these and the list is already cached from the page that linked here.
 */
export function EditReportPromptFormLoader() {
	const { id: guildId, promptId } = useParams<{ id: string; promptId: string }>();
	const { data: prompts, isLoading, error } = useAutomoderatorReportPrompts(guildId);

	if (error && prompts === undefined) {
		return <UserErrorHandler error={error} />;
	}

	if (isLoading) {
		return (
			<div className="mt-8 space-y-6">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-32 w-full" />
			</div>
		);
	}

	const existing = prompts!.find((prompt) => prompt.id === Number(promptId));
	if (!existing) {
		return (
			<EmptyState
				icon={<SvgAutoModerator height={28} width={28} />}
				subtitle="It may have been deleted, or its message removed from Discord."
				title="Prompt not found"
			/>
		);
	}

	return <ReportPromptForm existing={existing} />;
}
