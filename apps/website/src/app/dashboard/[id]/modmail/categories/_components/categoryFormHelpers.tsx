import Link from 'next/link';
import type { ModmailConfig } from '@/api/routes/modmail';
import { TemplatePlaceholdersHint } from '@/components/common/TemplatePlaceholdersHint';

export function GreetingMessageHelper({ guildId }: { readonly guildId: string }) {
	return (
		<>
			<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
				Falls back to the{' '}
				<Link className="underline hover:text-misc-accent" href={`/dashboard/${guildId}/modmail/config`}>
					guild default
				</Link>{' '}
				if unset.
			</p>
			<TemplatePlaceholdersHint />
		</>
	);
}

export function MaxConcurrentThreadsHelper({
	guildId,
	config,
}: {
	readonly config: ModmailConfig | undefined;
	readonly guildId: string;
}) {
	return (
		<p className="mt-1 text-sm text-secondary dark:text-secondary-dark">
			How many tickets a user may have open in this category specifically. Leave blank to use the{' '}
			<Link className="underline hover:text-misc-accent" href={`/dashboard/${guildId}/modmail/config`}>
				guild default
			</Link>
			{config ? ` (currently ${config.maxConcurrentThreads})` : ''}. Cannot exceed the guild default.
		</p>
	);
}
