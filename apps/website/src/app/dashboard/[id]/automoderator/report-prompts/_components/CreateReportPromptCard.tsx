'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SvgPlus } from '@/components/icons/SvgPlus';

interface CreateReportPromptCardProps {
	/**
	 * True when the guild has no reports channel. Rendered as an explanation rather than a hidden card: the
	 * reason is actionable and one page away, and a card that simply vanishes teaches nothing.
	 */
	readonly isDisabled: boolean;
}

export function CreateReportPromptCard({ isDisabled }: CreateReportPromptCardProps) {
	const { id: guildId } = useParams<{ id: string }>();

	if (isDisabled) {
		return (
			<div className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 text-center dark:border-on-secondary-dark dark:bg-card-dark">
				<span className="text-sm text-secondary dark:text-secondary-dark">
					Set a reports channel in{' '}
					<Link className="text-misc-accent underline" href={`/dashboard/${guildId}/automoderator/report-settings`}>
						Report Settings
					</Link>{' '}
					before posting a prompt.
				</span>
			</div>
		);
	}

	return (
		<Link
			className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-on-secondary bg-card p-4 hover:border-misc-accent dark:border-on-secondary-dark dark:bg-card-dark"
			href={`/dashboard/${guildId}/automoderator/report-prompts/new`}
		>
			<SvgPlus />
			<span className="text-lg font-medium text-primary dark:text-primary-dark">Post Prompt</span>
		</Link>
	);
}
