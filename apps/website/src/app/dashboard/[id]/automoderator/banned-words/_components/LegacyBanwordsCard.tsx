'use client';

import { LEGACY_BANWORD_ARCHIVE_UNTIL } from '@chatsift/core';
import { Button } from '@chatsift/web-core/components/Button';
import { Skeleton } from '@chatsift/web-core/components/Skeleton';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type { LegacyBanword } from '@/api/routes/automoderatorBanwords';
import { useLegacyBanwords } from '@/api/routes/automoderatorBanwords';
import { describeDuration } from '@/utils/duration';

/**
 * How the legacy `BanwordFlags` members read to somebody who last saw them in a slash command. `word` is not
 * a punishment at all -- it marked an entry as filtering message content -- and `name` marked one as also
 * filtering usernames, which is the single thing on this page that has no modern equivalent.
 */
const FLAG_LABELS: Record<string, string> = {
	word: 'Message content',
	name: 'Usernames',
	warn: 'Warn',
	mute: 'Mute',
	kick: 'Kick',
	ban: 'Ban',
	report: 'Report',
};

function describeEntry(entry: LegacyBanword): string {
	const punishments = entry.flags.filter((flag) => flag !== 'word' && flag !== 'name');
	if (punishments.length === 0) {
		return 'Deleted the message';
	}

	const described = punishments.map((flag) => FLAG_LABELS[flag] ?? flag).join(' + ');
	return entry.durationSeconds === null ? described : `${described} for ${describeDuration(entry.durationSeconds)}`;
}

function EntryRow({ entry }: { readonly entry: LegacyBanword }) {
	const scopes = entry.flags.filter((flag) => flag === 'word' || flag === 'name');

	return (
		<div className="flex flex-col gap-1 border-b border-on-secondary py-2 last:border-b-0 dark:border-on-secondary-dark sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
			<code className="min-w-0 break-all text-sm text-primary dark:text-primary-dark">{entry.word}</code>
			<span className="whitespace-nowrap text-sm text-secondary dark:text-secondary-dark">
				{describeEntry(entry)}
				{scopes.includes('name') && ' · also filtered usernames'}
			</span>
		</div>
	);
}

/**
 * The guild's pre-migration banned-word list (#11 P9), read-only.
 *
 * Banned words did not migrate: their matching half can only live in a native AutoMod rule, and AutoModerator
 * never writes to Discord's AutoMod. So every community rebuilds its keyword lists in Server Settings -- and
 * this card is what makes that a fair thing to have asked, because the old database it came from no longer
 * exists. Collapsed by default, since a guild that has already rebuilt its lists should not have to scroll
 * past the old ones forever.
 *
 * Renders nothing at all when there is no archive, which is every guild that joined after the migration.
 */
export function LegacyBanwordsCard() {
	const { id: guildId } = useParams<{ id: string }>();
	const [isOpen, setIsOpen] = useState(false);
	const { data: entries, isLoading, error } = useLegacyBanwords(guildId);

	// Deliberately silent on error rather than surfacing a banner: this is a historical footnote beside the
	// page's actual job, and a failed archive fetch must not be the thing standing between a manager and
	// their policies.
	if (error || (!isLoading && (!entries || entries.length === 0))) {
		return null;
	}

	if (isLoading) {
		return <Skeleton className="h-20 w-full rounded-lg" />;
	}

	const removedOn = new Date(`${LEGACY_BANWORD_ARCHIVE_UNTIL}T00:00:00Z`).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC',
	});

	return (
		<div className="flex flex-col gap-3 rounded-lg border border-on-secondary bg-card p-4 dark:border-on-secondary-dark dark:bg-card-dark">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-lg font-semibold text-primary dark:text-primary-dark">
					Your old banned words ({entries!.length})
				</span>
				<Button onPress={() => setIsOpen((open) => !open)}>
					<span className="text-misc-accent">{isOpen ? 'Hide' : 'Show list'}</span>
				</Button>
			</div>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				This is the word list this server had before AutoModerator moved to its new version, kept so you can rebuild it.
				Nothing here is active — add the words to a rule in <strong>Server Settings → AutoMod</strong>, then give that
				rule a policy above to say what should happen when it catches somebody.
			</p>

			<p className="text-sm text-secondary dark:text-secondary-dark">
				This copy is removed on {removedOn}. Save anything you still need before then.
			</p>

			{isOpen && (
				<div className="flex flex-col rounded-md border border-on-secondary px-3 dark:border-on-secondary-dark">
					{entries!.map((entry) => (
						<EntryRow entry={entry} key={entry.word} />
					))}
				</div>
			)}
		</div>
	);
}
