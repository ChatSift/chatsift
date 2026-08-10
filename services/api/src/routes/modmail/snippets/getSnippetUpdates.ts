import { getContext } from '@chatsift/backend-core';
import type { Snippets, SnippetsId, SnippetUpdates } from '@chatsift/db';
import type { APIUser, Snowflake } from '@discordjs/core';
import { notFound } from '@hapi/boom';
import { z } from 'zod';
import { defineRoute } from '../../../core/route.js';
import { isAuthed } from '../../../middleware/isAuthed.js';
import { snowflakeSchema } from '../../../util/schemas.js';
import { resolveUserBestEffort } from '../threads/util.js';

const paramsSchema = z.object({
	guildId: snowflakeSchema,
	snippetId: z.coerce
		.number()
		.int()
		.positive()
		.transform((value) => value as SnippetsId),
});

export type SnippetRevisionField = 'attachmentFilename' | 'attachmentUrl' | 'content' | 'name';

export interface SnippetRevision {
	/**
	 * Which fields this particular edit changed, derived rather than stored -- see the route's own doc
	 * comment. Always `['content']` for a legacy row (see {@link SnippetRevision.oldName}).
	 */
	changed: SnippetRevisionField[];
	id: number;
	oldAttachmentFilename: string | null;
	oldAttachmentUrl: string | null;
	oldContent: string;
	/**
	 * `null` means this row predates the #324 snapshot widening and only ever captured content -- the
	 * dashboard renders those content-only rather than inventing a name/attachment diff for them.
	 */
	oldName: string | null;
	updatedAt: Date;
	/**
	 * `APIUser` when Discord still knows the id, the bare snowflake otherwise -- mirrors
	 * `GetModmailConfigResult`'s `recordThreadContentEnabledByUser`.
	 */
	updatedBy: APIUser | Snowflake;
}

export interface SnippetRevisionsResult {
	revisions: SnippetRevision[];
}

interface SnippetSnapshot {
	attachmentFilename: string | null;
	attachmentUrl: string | null;
	content: string;
	/**
	 * `false` for a legacy `snippet_updates` row (see {@link SnippetRevision.oldName}), whose name and
	 * attachment columns were never populated -- so there's nothing meaningful to diff against there and
	 * only `content` can be compared.
	 */
	hasFullSnapshot: boolean;
	name: string | null;
}

/**
 * Flattens "the state a revision was replaced by" into one shape, whether that's the snapshot another
 * revision archived or the snippet as it currently stands.
 */
function toSnapshot(state: Snippets | SnippetUpdates): SnippetSnapshot {
	return 'oldContent' in state
		? {
				attachmentFilename: state.oldAttachmentFilename,
				attachmentUrl: state.oldAttachmentUrl,
				content: state.oldContent,
				hasFullSnapshot: state.oldName !== null,
				name: state.oldName,
			}
		: {
				attachmentFilename: state.attachmentFilename,
				attachmentUrl: state.attachmentUrl,
				content: state.content,
				hasFullSnapshot: true,
				name: state.name,
			};
}

/**
 * A snippet's edit history (#324). Each `snippet_updates` row is a full snapshot of the state an edit
 * overwrote, so *which* fields a given revision changed is worked out here by diffing each snapshot
 * against the state that replaced it -- the next-newer revision's snapshot, or the live `snippets` row
 * for the newest revision. Deriving it beats storing a `changed_fields` column that could disagree with
 * the snapshots sitting right next to it, and it's a few string compares over a list that's inherently
 * short (one row per human edit of one snippet), so there's nothing to pay for and nothing to paginate.
 *
 * Separate from `listSnippets.ts` rather than folded into it: the list renders every snippet in the
 * guild, and none of them need their history until someone opens one snippet's edit page.
 */
export default defineRoute({
	method: 'get',
	path: '/v3/guilds/:guildId/modmail/snippets/:snippetId/updates',
	schema: {
		params: paramsSchema,
	},
	middleware: isAuthed({
		fallthrough: false,
		isGlobalAdmin: false,
		isGuildManager: true,
	}),
	async handler(req): Promise<SnippetRevisionsResult> {
		const { guildId, snippetId } = req.params;
		const db = getContext().db;

		// `snippet_updates` carries no `guild_id` of its own, so the guild check has to go through the
		// snippet -- and the row is needed below anyway, as the newest revision's successor state.
		const [snippet] = await db<Snippets[]>`
			SELECT * FROM snippets WHERE id = ${snippetId} AND guild_id = ${guildId}
		`;

		if (!snippet) {
			throw notFound('snippet not found');
		}

		// `id DESC` breaks ties on `updated_at`: two edits within the same clock tick (or the legacy
		// migration's backfilled rows, which share whatever timestamp the old DB recorded) would otherwise
		// order arbitrarily, and this list's ordering is what the diffing below reads as "what replaced what".
		const rows = await db<SnippetUpdates[]>`
			SELECT * FROM snippet_updates WHERE snippet_id = ${snippetId} ORDER BY updated_at DESC, id DESC
		`;

		// One lookup per distinct editor, not per revision -- a snippet someone has tweaked a dozen times is
		// overwhelmingly a dozen edits by the same person.
		const editors = new Map<Snowflake, APIUser | Snowflake>();
		await Promise.all(
			[...new Set(rows.map((row) => row.updatedBy))].map(async (userId) =>
				editors.set(userId, await resolveUserBestEffort(guildId, userId, req.logger)),
			),
		);

		const revisions = rows.map((row, index): SnippetRevision => {
			// Newest first, so the state that replaced revision `index` is the snapshot of the revision right
			// before it in the list -- and for the newest revision, the snippet as it stands now.
			const next = toSnapshot(rows[index - 1] ?? snippet);
			const changed: SnippetRevisionField[] = [];

			if (row.oldName === null) {
				// Pre-#324 row: only `old_content` was ever recorded, and the write side back then only ran on a
				// content change, so content is exactly what it changed. Every other field would be read off
				// columns that were never populated.
				changed.push('content');
			} else {
				// Only `content` is comparable when the successor is itself a legacy row -- its other columns
				// were never populated, so diffing against them would invent changes nobody made. In practice
				// this can't happen (legacy rows are by definition older than every post-#324 one, and older
				// rows are never the successor), but the ordering isn't something this has to assume: the
				// legacy migration backfills `updated_at` from the old DB and could in principle land a row
				// anywhere in the timeline. `old_content` is NOT NULL in every era, so content always has a
				// real successor to compare with.
				if (next.hasFullSnapshot && row.oldName !== next.name) {
					changed.push('name');
				}

				if (row.oldContent !== next.content) {
					changed.push('content');
				}

				if (next.hasFullSnapshot && row.oldAttachmentUrl !== next.attachmentUrl) {
					changed.push('attachmentUrl');
				}

				if (next.hasFullSnapshot && row.oldAttachmentFilename !== next.attachmentFilename) {
					changed.push('attachmentFilename');
				}
			}

			return {
				changed,
				id: row.id,
				oldAttachmentFilename: row.oldAttachmentFilename,
				oldAttachmentUrl: row.oldAttachmentUrl,
				oldContent: row.oldContent,
				oldName: row.oldName,
				updatedAt: row.updatedAt,
				updatedBy: editors.get(row.updatedBy) ?? row.updatedBy,
			};
		});

		return { revisions };
	},
});
