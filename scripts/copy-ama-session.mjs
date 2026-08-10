// One-off script: copy a single `ama_sessions` row -- with its full triage state -- from one
// deployment's database into another's (canary -> live, for the AMA originally brought over from
// legacy `ChatSift/AMA` by `import-legacy-ama.mjs`).
//
// This is NOT `import-legacy-ama.mjs`. That one reads the *legacy* schema and deliberately flattens
// every question to 'PENDING_REVIEW', because legacy rows can't reconstruct question state. This one
// reads the *current* schema on both ends, so it carries state faithfully instead: question states,
// prepared answers, tags and their assignments, and merged-duplicate asker records all survive the
// copy. Use this when the work done on the source deployment is the thing worth keeping.
//
// Like its sibling it writes SQL to stdout rather than connecting to a database -- node builtins
// only, so it runs on a deploy host that can't resolve workspace packages (see the canary
// `ERR_MODULE_NOT_FOUND` note in docs), and the write is reviewable before it happens.
//
// Usage:
//   # 0. Find the session id on the SOURCE host if you don't know it:
//   #    ./compose exec -T postgres psql -U chatsift -d chatsift -c \
//   #      "SELECT id, guild_id, title, ended, created_at FROM ama_sessions ORDER BY id"
//   #
//   # 1. On the SOURCE host, extract the rows (read-only):
//   ./compose exec -T postgres psql -U chatsift -d chatsift -At -c "
//     SELECT json_build_object(
//       'session', row_to_json(s),
//       'prompt', (SELECT row_to_json(p) FROM ama_prompt_data p WHERE p.ama_id = s.id),
//       'questions', COALESCE((SELECT json_agg(q ORDER BY q.id)
//         FROM ama_questions q WHERE q.ama_id = s.id), '[]'::json),
//       'askers', COALESCE((SELECT json_agg(k ORDER BY k.id)
//         FROM ama_question_askers k JOIN ama_questions q ON q.id = k.question_id
//         WHERE q.ama_id = s.id), '[]'::json),
//       'tags', COALESCE((SELECT json_agg(t ORDER BY t.id)
//         FROM ama_question_tags t WHERE t.ama_id = s.id), '[]'::json),
//       'assignments', COALESCE((SELECT json_agg(a)
//         FROM ama_question_tag_assignments a WHERE a.ama_id = s.id), '[]'::json)
//     ) FROM ama_sessions s WHERE s.id = <ID>" > ama-session-<ID>.json
//   #
//   # 2. Generate the SQL (no network calls, no database connection):
//   node scripts/copy-ama-session.mjs --file ./ama-session-<ID>.json > copy.sql
//   #
//   # 3. Read copy.sql, then apply it on the TARGET host:
//   ./compose exec -T postgres psql -U chatsift -d chatsift -v ON_ERROR_STOP=1 < copy.sql
//
// Flags:
//   --file <path>        Required. The JSON produced by step 1.
//   --guild-id <id>      Override the source guild_id (rehearse against a test guild first).
//   --open               Import with `ended = false`. Default is `ended = true` (submissions closed),
//                        regardless of the source row -- see the note on the Submit button below.
//   --keep-message-ids   Carry `queue_message_id` / `answers_message_id` across verbatim instead of
//                        nulling them. See the note below before using this.
//
// Timestamps are passed through as the source rendered them rather than round-tripped through a JS
// `Date`, which would silently truncate microseconds.
//
// `share_token` is carried over rather than regenerated, so a `/ama-answers/:shareToken` link handed
// out from the source deployment keeps working against the target's own frontend.
//
// Two things deliberately do NOT survive the copy:
//
//   * **Discord message pointers.** `queue_message_id` and `answers_message_id` name messages posted
//     by the *source* deployment's bot -- a different Discord application. The target's bot can read
//     those messages but can never edit them, so carrying them over turns every path that edits a
//     question's live message (merging a duplicate into an already-sent question, refreshing an
//     embed) from "no message to update" into a hard 403. Nulling them degrades instead: attachment
//     recovery returns `[]` and the edit paths no-op, which is what `resolveCurrentQueueMessage`
//     already handles for a dashboard-only question. `--keep-message-ids` opts back in if both
//     deployments genuinely run the same bot application.
//   * **Submission state.** The session lands `ended = true` by default. The prompt message this AMA
//     was created from carries a Submit button owned by whichever bot posted it; the target's bot
//     won't answer it. If you want live submissions, pass `--open` AND repost the prompt from the
//     target's dashboard so the button belongs to the target's bot.

import { readFile } from 'node:fs/promises';
import process from 'node:process';

function flagValue(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const filePath = flagValue('--file');
if (!filePath) {
	console.error('--file <path to the extracted JSON> is required');
	process.exit(1);
}

const guildIdOverride = flagValue('--guild-id');
const ended = !process.argv.includes('--open');
const keepMessageIds = process.argv.includes('--keep-message-ids');

// Dollar-quote tag for the DO block. Asserted below to not appear in any emitted literal, since a
// collision would terminate the block early and produce syntactically broken SQL.
const DOLLAR_TAG = '$ama_copy$';

// Mirrors the `ama_question_state` enum. Validated rather than trusted so a value from a
// hand-edited JSON file fails here, with a readable message, instead of inside psql.
const QUESTION_STATES = new Set(['PENDING_REVIEW', 'APPROVED', 'DENIED', 'ASKED']);

const raw = JSON.parse(await readFile(filePath, 'utf8'));
const { session, prompt, questions = [], askers = [], tags = [], assignments = [] } = raw;

if (!session?.id) {
	console.error(`${filePath} doesn't look like the expected { session, prompt, questions, ... } shape`);
	process.exit(1);
}

if (!prompt?.prompt_message_id) {
	// `ama_prompt_data` is 1:1 and NOT NULL on both columns; a session without it can't be rebuilt.
	console.error(`${filePath} has no ama_prompt_data row -- refusing to emit an incomplete session`);
	process.exit(1);
}

const guildId = guildIdOverride ?? session.guild_id;

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

/** Same, for a `TIMESTAMPTZ` column -- `NULL` stays unquoted and uncast. */
function ts(value) {
	return value === null || value === undefined ? 'NULL' : `${lit(value)}::timestamptz`;
}

/** Renders a JSON array of strings as a `TEXT[]` literal. */
function textArray(values) {
	if (!values?.length) {
		return `'{}'::TEXT[]`;
	}

	return `ARRAY[${values.map((value) => lit(value)).join(', ')}]::TEXT[]`;
}

for (const question of questions) {
	if (!QUESTION_STATES.has(question.state)) {
		console.error(`Aborting: question #${question.id} has unknown state ${JSON.stringify(question.state)}`);
		process.exit(1);
	}
}

// Reported at the end so an operator can tell, before applying, whether nulling the pointers is
// actually throwing anything away in this particular copy.
const droppedMessageIds = keepMessageIds
	? 0
	: questions.filter((question) => question.queue_message_id ?? question.answers_message_id).length;

const askersByQuestion = new Map();
for (const asker of askers) {
	const list = askersByQuestion.get(asker.question_id) ?? [];
	list.push(asker);
	askersByQuestion.set(asker.question_id, list);
}

const tagIdsByQuestion = new Map();
for (const assignment of assignments) {
	const list = tagIdsByQuestion.get(assignment.question_id) ?? [];
	list.push(assignment.tag_id);
	tagIdsByQuestion.set(assignment.question_id, list);
}

const lines = [];
lines.push(
	`-- Generated by scripts/copy-ama-session.mjs on ${new Date().toISOString()}`,
	`-- Source: ama_sessions.id = ${session.id} ${JSON.stringify(session.title)} (guild ${session.guild_id})`,
	`-- Target guild: ${guildId}${guildIdOverride ? ' (overridden)' : ''}`,
	`-- ${questions.length} question(s), ${tags.length} tag(s), ${assignments.length} tag assignment(s), ` +
		`${askers.length} merged-asker row(s)`,
	`-- ended = ${ended}; message ids ${keepMessageIds ? 'carried over' : 'nulled'}`,
	'',
	'BEGIN;',
	'',
	`DO ${DOLLAR_TAG}`,
	'DECLARE',
	'  v_ama_id INTEGER;',
	'  v_tag_id INTEGER;',
	'  v_qid    INTEGER;',
	'BEGIN',
	// Maps source ids to the identity values the target assigns, so tag assignments can be rebuilt
	// without assuming the two databases hand out the same numbers. Dropped at COMMIT.
	'  CREATE TEMP TABLE _ama_copy_tag_map (old_id INTEGER PRIMARY KEY, new_id INTEGER NOT NULL)',
	'    ON COMMIT DROP;',
	'',
	'  INSERT INTO ama_sessions (',
	'    guild_id, queue_id, title, answers_channel_id, prompt_channel_id,',
	'    allowed_question_uploads, ended, scheduled_close_at, prepared_answers_enabled,',
	'    review_enabled, share_token, guest_ids, created_at',
	'  ) VALUES (',
	`    ${lit(guildId)}, ${lit(session.queue_id)}, ${lit(session.title)}, ${lit(session.answers_channel_id)}, ${lit(session.prompt_channel_id)},`,
	`    ${session.allowed_question_uploads}, ${ended}, ${ts(session.scheduled_close_at)}, ${session.prepared_answers_enabled},`,
	`    ${session.review_enabled}, ${lit(session.share_token)}, ${textArray(session.guest_ids)}, ${ts(session.created_at)}`,
	'  ) RETURNING id INTO v_ama_id;',
	'',
	'  INSERT INTO ama_prompt_data (ama_id, prompt_message_id, prompt_json_data)',
	`  VALUES (v_ama_id, ${lit(prompt.prompt_message_id)}, ${lit(prompt.prompt_json_data)});`,
	'',
);

for (const tag of tags) {
	lines.push(
		`  -- source tag #${tag.id} ${JSON.stringify(tag.name)}`,
		'  INSERT INTO ama_question_tags (ama_id, name, created_at)',
		`  VALUES (v_ama_id, ${lit(tag.name)}, ${ts(tag.created_at)}) RETURNING id INTO v_tag_id;`,
		`  INSERT INTO _ama_copy_tag_map (old_id, new_id) VALUES (${tag.id}, v_tag_id);`,
		'',
	);
}

for (const question of questions) {
	const queueMessageId = keepMessageIds ? lit(question.queue_message_id) : 'NULL';
	const answersMessageId = keepMessageIds ? lit(question.answers_message_id) : 'NULL';

	lines.push(
		`  -- source question #${question.id} (${question.state})`,
		'  INSERT INTO ama_questions (',
		'    ama_id, author_id, state, content, queue_message_id, answers_message_id,',
		'    answer_content, answer_image_url, answered_by_id, answered_at, created_at, updated_at',
		'  ) VALUES (',
		`    v_ama_id, ${lit(question.author_id)}, ${lit(question.state)}, ${lit(question.content)}, ${queueMessageId}, ${answersMessageId},`,
		`    ${lit(question.answer_content)}, ${lit(question.answer_image_url)}, ${lit(question.answered_by_id)}, ${ts(question.answered_at)}, ${ts(question.created_at)}, ${ts(question.updated_at)}`,
		'  ) RETURNING id INTO v_qid;',
	);

	for (const asker of askersByQuestion.get(question.id) ?? []) {
		lines.push(
			'  INSERT INTO ama_question_askers (question_id, author_id, content, merged_at)',
			`  VALUES (v_qid, ${lit(asker.author_id)}, ${lit(asker.content)}, ${ts(asker.merged_at)});`,
		);
	}

	for (const tagId of tagIdsByQuestion.get(question.id) ?? []) {
		// `ama_id` is denormalized here on purpose -- the composite FKs pin a tag assignment to the same
		// AMA as both its question and its tag, so it has to be passed explicitly. Selecting through the
		// map (rather than a bare VALUES) also means a dangling tag_id inserts zero rows instead of
		// violating the FK -- which can't happen given the extraction query scopes both to one session,
		// but keeps a hand-edited JSON file from producing a confusing constraint error.
		lines.push(
			'  INSERT INTO ama_question_tag_assignments (question_id, tag_id, ama_id)',
			`  SELECT v_qid, new_id, v_ama_id FROM _ama_copy_tag_map WHERE old_id = ${tagId};`,
		);
	}

	lines.push('');
}

lines.push(
	"  RAISE NOTICE 'Copied in as ama_sessions.id = %', v_ama_id;",
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

const stateCounts = {};
for (const question of questions) {
	stateCounts[question.state] = (stateCounts[question.state] ?? 0) + 1;
}

console.error(
	`Generated SQL for ama_sessions #${session.id} -> guild ${guildId}: ${questions.length} question(s) ` +
		`(${Object.entries(stateCounts)
			.map(([state, count]) => `${count} ${state}`)
			.join(', ')}), ${tags.length} tag(s), ${assignments.length} assignment(s), ${askers.length} merged asker(s).`,
);

if (session.ended !== ended) {
	console.error(`note: source had ended = ${session.ended}, emitting ended = ${ended}`);
}

if (droppedMessageIds) {
	console.error(
		`note: nulled Discord message ids on ${droppedMessageIds} question(s) -- they pointed at messages ` +
			`posted by the source deployment's bot. Pass --keep-message-ids only if both run the same bot application.`,
	);
}
