// One-off script: generate the SQL to import a single legacy `ChatSift/AMA` session (and its
// questions) into the new stack's `ama_sessions` / `ama_prompt_data` / `ama_questions` tables.
//
// This is deliberately NOT the general AMA migration -- M4 (docs/roadmap/05-migration-cutover.md)
// chose drain-and-swap precisely because legacy rows can't reconstruct question state. This imports
// ONE AMA for ONE customer, resetting every question to 'PENDING_REVIEW' ("just asked") so they have
// real data to run through the dashboard's triage features. Rough edges are expected and accepted.
//
// It writes SQL to stdout rather than connecting to a database. That keeps it dependency-free (node
// builtins only, so it runs on a deploy host with no installed workspace), and makes the prod write
// reviewable before it happens -- read the SQL, then feed it to psql.
//
// Usage:
//   # 1. On the legacy prod host, extract the rows (read-only):
//   #    docker exec postgres-old psql -U user -d ama -At -c "
//   #      SELECT json_build_object(
//   #        'ama', row_to_json(a),
//   #        'questions', COALESCE(
//   #          (SELECT json_agg(q ORDER BY q.id) FROM \"AmaQuestion\" q WHERE q.\"amaId\" = a.id),
//   #          '[]'::json)
//   #      ) FROM \"Ama\" a WHERE a.id = <ID>" > ama-<ID>.json
//   #
//   # 2. Generate the SQL (AMA_BOT_TOKEN optional, see --no-fetch-prompt):
//   node scripts/import-legacy-ama.mjs --file ./ama-<ID>.json > import.sql
//   #
//   # 3. Read import.sql, then apply it:
//   docker compose exec -T postgres psql -U chatsift -d chatsift -v ON_ERROR_STOP=1 < import.sql
//
// Flags:
//   --file <path>        Required. The JSON produced by step 1.
//   --guild-id <id>      Override the legacy guildId (rehearse against a test guild first).
//   --tag-answered       Tag questions that had an `answerMessageId` with a "Previously answered" tag.
//   --no-fetch-prompt    Skip the Discord read below and always synthesize the prompt body.
//
// The generated SQL is a single BEGIN/COMMIT wrapping one plpgsql DO block, so it either fully
// applies or not at all. Run psql with -v ON_ERROR_STOP=1 so a failure aborts rather than
// half-applying. Nothing is ever written to Discord -- the only Discord call this script makes is a
// READ of the legacy prompt message, used to reconstruct `ama_prompt_data.prompt_json_data` (which is
// NOT NULL and has no legacy source).

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

function flagValue(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const filePath = flagValue('--file');
if (!filePath) {
	console.error('--file <path to the extracted legacy JSON> is required');
	process.exit(1);
}

const guildIdOverride = flagValue('--guild-id');
const tagAnswered = process.argv.includes('--tag-answered');
const fetchPrompt = !process.argv.includes('--no-fetch-prompt');

// Discord's blurple, mirroring `BLURPLE` in packages/private/core/src/lib/amaEmbeds.ts.
const BLURPLE = 0x72_89_da;

// Dollar-quote tag for the DO block. Asserted below to not appear in any emitted literal, since a
// collision would terminate the block early and produce syntactically broken SQL.
const DOLLAR_TAG = '$ama_import$';

const raw = JSON.parse(await readFile(filePath, 'utf8'));
const legacyAma = raw.ama;
const legacyQuestions = raw.questions ?? [];

if (!legacyAma?.id) {
	console.error(`${filePath} doesn't look like the expected { ama, questions } shape`);
	process.exit(1);
}

const guildId = guildIdOverride ?? legacyAma.guildId;

/**
 * Renders a JS value as a SQL literal. Single quotes are doubled, and NUL bytes are stripped
 * (Postgres rejects them outright in text values). Assumes `standard_conforming_strings = on`, the
 * default since Postgres 9.1, so backslashes in question text stay literal rather than becoming
 * escape sequences.
 */
function lit(value) {
	if (value === null || value === undefined) {
		return 'NULL';
	}

	return `'${String(value).replaceAll('\0', '').replaceAll("'", "''")}'`;
}

/**
 * `ama_prompt_data.prompt_json_data` is NOT NULL and gets `JSON.parse`d back into a
 * `RESTPostAPIChannelMessageJSONBody` by repostPrompt.ts / amaRepostSelect.ts / the dashboard's
 * `bestEffortPromptFields`. The legacy schema never stored it, so read the real prompt message back
 * off Discord when we still can, and fall back to a minimal synthesized body when we can't (message
 * deleted, channel gone, no token, the AMA bot not in that guild).
 */
async function resolvePromptJsonData() {
	if (!fetchPrompt) {
		return null;
	}

	const token = process.env.AMA_BOT_TOKEN;
	if (!token) {
		console.error('note: AMA_BOT_TOKEN not set -- synthesizing prompt_json_data from the legacy title instead');
		return null;
	}

	try {
		const response = await fetch(
			`https://discord.com/api/v10/channels/${legacyAma.promptChannelId}/messages/${legacyAma.promptMessageId}`,
			{ headers: { authorization: `Bot ${token}` } },
		);

		if (!response.ok) {
			console.error(`note: couldn't fetch the legacy prompt message (${response.status}) -- synthesizing instead`);
			return null;
		}

		const message = await response.json();
		// Only the fields a message-create body accepts -- `components` is deliberately excluded, since
		// repostPrompt.ts appends its own Submit button and a duplicate would render two.
		return { content: message.content || undefined, embeds: message.embeds ?? [] };
	} catch (error) {
		console.error(`note: prompt message fetch failed (${error.message}) -- synthesizing instead`);
		return null;
	}
}

const promptJsonData = (await resolvePromptJsonData()) ?? { embeds: [{ color: BLURPLE, title: legacyAma.title }] };

// Legacy `AmaQuestion` has no timestamp column at all -- the autoincrement id is the only ordering
// signal. Spacing imported rows one second apart off the session's own createdAt preserves submission
// order in the dashboard's sort without inventing plausible-looking real timestamps.
const baseCreatedAt = new Date(legacyAma.createdAt ?? Date.now());

const lines = [];
lines.push(
	`-- Generated by scripts/import-legacy-ama.mjs on ${new Date().toISOString()}`,
	`-- Source: legacy AMA #${legacyAma.id} ${JSON.stringify(legacyAma.title)}`,
	`-- Target guild: ${guildId}${guildIdOverride ? ` (overridden; legacy value was ${legacyAma.guildId})` : ''}`,
	`-- Questions: ${legacyQuestions.length}, all imported as PENDING_REVIEW`,
	'',
	'BEGIN;',
	'',
	`DO ${DOLLAR_TAG}`,
	'DECLARE',
	'  v_ama_id  INTEGER;',
	'  v_tag_id  INTEGER;',
	'  v_qid     INTEGER;',
	'BEGIN',
	// review_enabled = true with queue_id = NULL is the dashboard-only review stage (satisfies
	// ama_sessions_review_enabled_check) -- nothing gets posted to Discord by this import.
	// prepared_answers_enabled = true so the first dashboard Approve holds at APPROVED instead of
	// immediately publishing an imported question into the customer's live answers channel.
	// guest_ids is left to its column DEFAULT '{}'.
	'  INSERT INTO ama_sessions (',
	'    guild_id, title, answers_channel_id, prompt_channel_id,',
	'    queue_id, allowed_question_uploads, ended, scheduled_close_at,',
	'    review_enabled, prepared_answers_enabled, share_token, created_at',
	'  ) VALUES (',
	`    ${lit(guildId)}, ${lit(legacyAma.title)}, ${lit(legacyAma.answersChannel)}, ${lit(legacyAma.promptChannelId)},`,
	'    NULL, 1, true, NULL,',
	`    true, true, ${lit(randomBytes(24).toString('hex'))}, ${lit(baseCreatedAt.toISOString())}::timestamptz`,
	'  ) RETURNING id INTO v_ama_id;',
	'',
	'  INSERT INTO ama_prompt_data (ama_id, prompt_message_id, prompt_json_data)',
	`  VALUES (v_ama_id, ${lit(legacyAma.promptMessageId)}, ${lit(JSON.stringify(promptJsonData))});`,
	'',
);

if (tagAnswered) {
	// `answerMessageId IS NOT NULL` is the only real state the legacy DB carries. Resetting everything
	// to PENDING_REVIEW would otherwise throw it away, so preserve it as a tag.
	lines.push(
		'  INSERT INTO ama_question_tags (ama_id, name)',
		`  VALUES (v_ama_id, ${lit('Previously answered')}) RETURNING id INTO v_tag_id;`,
		'',
	);
}

for (const [index, question] of legacyQuestions.entries()) {
	const createdAt = new Date(baseCreatedAt.getTime() + index * 1_000).toISOString();
	// Legacy `imageUrl` is dropped: the new stack never persists question attachments (it re-reads them
	// off the live Discord message, see services/api/src/routes/ama/questions/util.ts), and an imported
	// question has no such message. `answerMessageId` is dropped too -- every question is being reset to
	// PENDING_REVIEW, so a pointer to an old answers-channel message would be stale state, not
	// recovered state.
	lines.push(
		`  -- legacy question #${question.id}`,
		'  INSERT INTO ama_questions (ama_id, author_id, content, state, created_at, updated_at)',
		`  VALUES (v_ama_id, ${lit(question.authorId)}, ${lit(question.content)}, 'PENDING_REVIEW',`,
		`          ${lit(createdAt)}::timestamptz, ${lit(createdAt)}::timestamptz)`,
		'  RETURNING id INTO v_qid;',
	);

	if (tagAnswered && question.answerMessageId) {
		// `ama_id` is denormalized here on purpose -- the composite FKs pin a tag assignment to the same
		// AMA as both its question and its tag, so it has to be passed explicitly.
		lines.push(
			'  INSERT INTO ama_question_tag_assignments (question_id, tag_id, ama_id)',
			'  VALUES (v_qid, v_tag_id, v_ama_id);',
		);
	}

	lines.push('');
}

lines.push(
	"  RAISE NOTICE 'Imported as ama_sessions.id = %', v_ama_id;",
	"  RAISE NOTICE 'To undo: DELETE FROM ama_sessions WHERE id = %;', v_ama_id;",
	`END ${DOLLAR_TAG};`,
	'',
	'COMMIT;',
	'',
);

const sql = lines.join('\n');

// A literal containing the dollar-quote tag would close the DO block early and produce syntactically
// broken SQL, so refuse to emit rather than hand over something that half-parses.
const bodyBetweenTags = sql.slice(sql.indexOf(DOLLAR_TAG) + DOLLAR_TAG.length, sql.lastIndexOf(DOLLAR_TAG));
if (bodyBetweenTags.includes(DOLLAR_TAG)) {
	console.error(`Aborting: the data contains ${DOLLAR_TAG}, which would terminate the DO block early`);
	process.exit(1);
}

process.stdout.write(sql);

console.error(
	`Generated SQL for legacy AMA #${legacyAma.id} -> guild ${guildId}: ` +
		`1 session, ${legacyQuestions.length} question(s), all PENDING_REVIEW.`,
);
