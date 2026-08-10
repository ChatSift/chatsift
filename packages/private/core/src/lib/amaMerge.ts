import type { AmaQuestionState } from '@chatsift/db';

/**
 * Which states a question can be in to be merged *away* as a duplicate. Deliberately narrower than
 * {@link MERGE_TARGET_STATES}: merging away deletes the row (and its live Discord message), so it's
 * only ever safe on a question nobody has acted on yet -- an APPROVED/ASKED question would take a
 * guest's prepared answer or an already-public post down with it, and DENIED is a resolved decision.
 *
 * Lives here rather than in `services/api`'s browser-safe `ama-schemas` module (its previous home)
 * because `services/ama-bot` has its own copy of this flow and doesn't depend on `@chatsift/api` --
 * `@chatsift/core` is the one package all three of api/ama-bot/apps-website already share, so it's the
 * only home where the set can't drift.
 */
export const MERGE_SOURCE_STATES: ReadonlySet<AmaQuestionState> = new Set([
	'PENDING_REVIEW',
] as readonly AmaQuestionState[]);

/**
 * Which states a question can be in to *absorb* a duplicate (#328). Absorbing is non-destructive --
 * the target keeps its own content, answer and message, and only gains an extra asker -- so it stays
 * legal right through the guest-answer stage and after the question has been publicly posted, with
 * the live embed's merged-asker count re-rendered in place (see `getBaseEmbeds`'s `extraAskerCount`).
 *
 * DENIED is excluded: folding a new asker into a rejected question would silently resurrect a
 * decision a mod already made, and there's no live message to refresh either way.
 */
export const MERGE_TARGET_STATES: ReadonlySet<AmaQuestionState> = new Set([
	'PENDING_REVIEW',
	'APPROVED',
	'ASKED',
] as readonly AmaQuestionState[]);
