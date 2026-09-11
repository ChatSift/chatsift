import type { BotId } from '@chatsift/core';
import { APPEALS_SECTION_LIST } from './appealsSections';
import { AUTOMODERATOR_SECTION_GROUPS } from './automoderatorSections';
import { MODMAIL_SECTION_LIST } from './modmailSections';
import { SOCIAL_SECTION_LIST } from './socialSections';

export interface BotSection {
	readonly segment: string;
	readonly subtitle: string;
	readonly title: string;
}

/**
 * Every bot's sections, keyed the way its URLs are (`/dashboard/:guildId/<bot>/<segment>`), for anything that
 * lists them across bots -- today the jump-to palette. A `Record<BotId, ...>` so a new bot fails to compile
 * until it has a row here, rather than silently going unlisted.
 *
 * AMA is the one bot whose hub does not render from a list: it has a single section, so the page keeps its
 * one card inline and this restates it. The title matches the breadcrumb's `amas` label.
 */
export const BOT_SECTIONS: Record<BotId, readonly BotSection[]> = {
	AMA: [{ segment: 'amas', title: 'Sessions', subtitle: 'Create and manage AMAs in your community' }],
	MODMAIL: MODMAIL_SECTION_LIST,
	SOCIAL: SOCIAL_SECTION_LIST,
	// The annotation widens each group's `as const` tuple to the common shape; `flatMap` cannot unify the
	// four literal tuple types on its own.
	AUTOMODERATOR: AUTOMODERATOR_SECTION_GROUPS.flatMap((group): readonly BotSection[] => group.sections),
	APPEALS: APPEALS_SECTION_LIST,
};

/**
 * The bot a URL segment names (`modmail` -> `MODMAIL`), or `null` for anything else under a guild
 * (`settings`, or a segment that is not a bot at all).
 */
export function botFromSegment(segment: string): BotId | null {
	const candidate = segment.toUpperCase();
	return Object.hasOwn(BOT_SECTIONS, candidate) ? (candidate as BotId) : null;
}
