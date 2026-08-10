import type { AmaQuestions, Database, DatabaseTransaction } from '@chatsift/db';

/**
 * How many *other* distinct people asked this same question, i.e. merged-duplicate askers excluding the
 * question's own author (#326) -- what `getBaseEmbeds`'s `extraAskerCount` renders. Mirrors
 * `services/api`'s own `countExtraAskers` (kept as a separate copy for the same reason
 * `resolveCurrentMessage` is: different service, no shared cross-service home for AMA-domain SQL).
 *
 * Takes the `sql` handle rather than reaching for the context so a caller mid-merge can count inside the
 * same transaction it just inserted the askers in.
 *
 * The self-exclusion is load-bearing: nothing stops someone asking twice and a mod merging one of their
 * questions into the other, and the merge INSERT has no guard for it -- without the filter the embed
 * would announce "1 other person" about the author themselves. `::int` because postgres.js hands back a
 * bare `COUNT(*)` (int8) as a string, which every downstream `> 0` check would read as truthy.
 */
export async function countExtraAskers(
	sql: Database | DatabaseTransaction,
	question: Pick<AmaQuestions, 'authorId' | 'id'>,
): Promise<number> {
	const [row] = await sql<{ count: number }[]>`
		SELECT COUNT(*)::int AS count FROM ama_question_askers
		WHERE question_id = ${question.id} AND author_id <> ${question.authorId}
	`;

	return row?.count ?? 0;
}
