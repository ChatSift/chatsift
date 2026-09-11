// Order is load-bearing for presentation only (the dashboard's guild nav and the homepage's bot grid both
// map over this). 'SOCIAL' (#343) is a real BotId from its API phase onward -- what it does *not* have yet is
// public marketing copy, which is why `apps/website`'s `marketingBots` is a partial record keyed off this and
// the public pages render only the bots that have an entry (see that file). 'AUTOMODERATOR' is in the same
// position from the port's P0 onward (docs/roadmap/11-automoderator-port.md), and 'APPEALS' from P1 onward
// (#232, docs/roadmap/09-appeals.md).
//
// Spelled 'AUTOMODERATOR', not 'AUTOMOD': the port makes our filter subsystem talk to *Discord's* AutoMod
// constantly, and the two are different things. Keeping the product's name unabbreviated is what stops that
// ambiguity from becoming permanent in log lines, metric labels and Redis keys.
export const BOTS = ['AMA', 'MODMAIL', 'SOCIAL', 'AUTOMODERATOR', 'APPEALS'] as const;

export type BotId = (typeof BOTS)[number];

/**
 * Discord blurple -- the accent every dashboard-authored embed (ticket panels, AMA prompts) falls back to
 * when nobody picked a color. Shared so the dashboard's preview swatch and the value services/api actually
 * posts can't drift apart, which they did while this was a magic number copied into four routes and two
 * preview components.
 */
export const DEFAULT_EMBED_COLOR = 0x7289da;

/**
 * What Social posts when a guild has no `level_up_notification_message` of its own (#343). Shared for the same
 * reason as the color above: the dashboard shows it as the field's placeholder, since leaving that field blank
 * is exactly what selects it, and a stale copy there would advertise a message the bot doesn't send.
 */
export const DEFAULT_LEVEL_UP_MESSAGE =
	'{{username}}, you just reached level {{level}} in {{guildName}}{{earnedRewards}}!';

export const NewAccessTokenHeader = 'X-Update-Access-Token' as const;
export const RefreshTokenCookie = 'refresh_token' as const;

/**
 * `unban.app`'s session cookie (#232 P3). A distinct *name* on top of the distinct cookie domain
 * (`APPEALS_ROOT_DOMAIN`) and the `kind: 'appeals'` discriminator inside the JWT, so an appellant session and a
 * dashboard session are unable to be mistaken for one another at three independent layers rather than one --
 * see `services/api/src/middleware/isAppealsAuthed.ts`, which is a separate middleware from `isAuthed` for the
 * same reason.
 */
export const AppealsRefreshTokenCookie = 'appeals_refresh_token' as const;

/**
 * Carries the WS gateway's per-tab `realtimeClientId` (`apps/website/src/api/realtimeClientId.ts`) on an HTTP
 * mutation request, so `services/api/src/core/server.ts`'s `realtimeChannel` broadcast hook can tag the
 * resulting invalidate signal with which browser tab caused it -- see that file's doc comment for why this has
 * to be a value separate from the session's user id.
 */
export const RealtimeClientIdHeader = 'X-Realtime-Client-Id' as const;

/**
 * Marks a caller that physically cannot persist a `Set-Cookie` -- today that's `apps/website`'s SSR/RSC fetch
 * path (`apiFetchServer`), which forwards the browser's cookies to the API but has nowhere to put the response's:
 * Next refuses `cookies().set()` during a server-component render, so every cookie the API writes back on that
 * path is dropped on the floor.
 *
 * Almost everything the session layer writes is idempotent enough for that not to matter -- a re-signed refresh
 * JWT wrapping the same Discord credentials is no loss. The one thing that is *not* is a Discord refresh-token
 * rotation: Discord invalidates the old token the instant the new pair is issued, so a rotation performed for a
 * caller that then drops the cookie leaves the browser holding a spent credential and a session that hard-logs-out
 * the next time it's used (#384). `services/api`'s `middleware/isAuthed.ts` reads this header to refuse exactly
 * that, and nothing else.
 */
export const CookielessClientHeader = 'X-Cookieless-Client' as const;

/**
 * A canned AutoModerator report reason (P3): how long one may be, and how many a guild may have.
 *
 * Both are Discord's limits rather than ours -- a preset is rendered as a select-menu option, whose label caps
 * at 100 characters, and a select menu holds 25 options. They live here rather than beside the API's zod schema
 * because **three** places have to agree: `services/api` validates writes against them, `apps/website` renders
 * the form against them, and `automoderator-bot` reads only the first `REPORT_PRESET_MAX_COUNT` presets when it
 * builds the reason picker. The bot has no dependency on `@chatsift/api`, so before this the bot's `LIMIT` was
 * a bare `25` that would silently disagree the moment the cap moved -- presets saved on the dashboard that the
 * picker never offers.
 */
export const REPORT_PRESET_MAX_LENGTH = 100;

export const REPORT_PRESET_MAX_COUNT = 25;

/**
 * Discord's own ceiling on a communication timeout, in seconds (28 days). Shared for the same three-consumer
 * reason the preset caps above are: `automoderator-bot` caps `/mute` and the report card's mute modal against
 * it, `services/api` rejects a warn-ladder MUTE rung longer than it, and `apps/website` says so on the field
 * before anyone submits. A ladder rung the API accepts and the bot then silently clamps is a configuration
 * screen that lies about what it saved.
 */
export const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

/**
 * How many rungs a warn ladder may hold (P2, feature 22). Ours rather than Discord's: nothing renders a rung as
 * a select option, so the cap exists only to keep the per-warn ladder lookup and the editor bounded. Twenty-five
 * warns is already far past the point where a guild is choosing to ban somebody.
 */
export const WARN_PUNISHMENT_MAX_COUNT = 25;

/**
 * The highest `warns` value a rung may sit at. Same reasoning as the count cap -- and it is what stops the
 * editor being handed a rung nobody's warn count will ever reach.
 */
export const WARN_PUNISHMENT_MAX_WARNS = 100;

/**
 * The longest a warning can be configured to count for (P2, feature 23). Ten years, past which "warnings never
 * expire" is what the guild actually means and `NULL` says it directly. Here rather than beside the API's zod
 * schema for the same three-consumer reason as the caps above: `services/api` validates writes against it and
 * `apps/website` renders the field against it, and a form that accepts a value the route rejects is a form that
 * lies about what it saved.
 */
export const AUTO_PARDON_MAX_DAYS = 3_650;

/**
 * How many channels one guild may exempt from the message log (P4, feature 35). Ours, not Discord's: the bot
 * loads the whole set on every logged edit and delete, so the cap is what keeps that a small constant-size read
 * rather than something a guild can grow without noticing. A hundred is well past the point where exempting a
 * category instead -- which this matches up the channel tree, so one row covers everything under it -- is the
 * thing the guild actually wants.
 */
export const LOG_EXEMPTION_MAX_COUNT = 100;

/**
 * How many roles one guild may mark as bypassing every filter (P5, feature 10). Ours, not Discord's: the bot
 * loads the whole set to decide whether to act on a filter hit, so the cap is what keeps that a small
 * constant-size read. Twenty-five is already far past the point where the guild means "staff", which is better
 * expressed as one role.
 */
export const BYPASS_ROLE_MAX_COUNT = 25;

/**
 * How many banword policies one guild may configure (P5, feature 01). Sized against what the feature is *for*:
 * a rule-level policy covers a whole keyword list in one row, so a guild needing hundreds of these is one that
 * should be splitting its words across native AutoMod rules instead. Bounded for the same reason as the caps
 * above -- the bot reads a rule's policies on every native AutoMod hit, which is the hottest read this product
 * has.
 */
export const BANWORD_POLICY_MAX_COUNT = 250;

/**
 * The longest a single AutoMod keyword may be, mirroring Discord's own limit on a `keyword_filter` entry. Ours
 * only in the sense that we copy it: a policy naming a keyword longer than Discord can store is a policy that
 * can never match, so the API rejects it rather than writing a row that does nothing.
 */
export const AUTOMOD_KEYWORD_MAX_LENGTH = 60;

/**
 * How many domains one guild may allowlist for the URL filter (P5b, feature 02). Ours, not Discord's: the bot
 * reads the whole set for every message that contains a link, so the cap is what keeps that a bounded read on
 * the hottest path this filter has. A guild needing more than this is one that wants the filter off.
 */
export const ALLOWED_URL_MAX_COUNT = 250;

/**
 * The longest an allowlist entry may be, which is the DNS limit on a fully-qualified name. Anything longer is
 * not a domain and could never match a host the bot extracts from a message.
 */
export const ALLOWED_URL_MAX_LENGTH = 253;

/**
 * How many servers one guild may allowlist for the invite filter (P5b, feature 03). Sized well below the URL
 * cap on purpose -- an invite allowlist names partner servers, and a guild with a hundred of them is running a
 * directory rather than a filter.
 */
export const ALLOWED_INVITE_MAX_COUNT = 100;

/**
 * How many channels one guild may exempt from the runner filters (P5b, feature 09), counted per channel rather
 * than per (channel, filter) pair. Matches `LOG_EXEMPTION_MAX_COUNT` for the same reason it has that value:
 * exemptions match up the channel tree, so one category row covers everything under it and a guild reaching a
 * hundred is listing channels one by one when it should be listing their category.
 */
export const FILTER_EXEMPTION_MAX_COUNT = 100;

/**
 * How many rungs a trigger ladder may hold (P5c, feature 11). Matches `WARN_PUNISHMENT_MAX_COUNT` because it is
 * the same kind of cap on the same kind of editor -- and because a guild whose members are tripping the filters
 * twenty-five times is past the point where another rung is the answer.
 */
export const TRIGGER_PUNISHMENT_MAX_COUNT = 25;

/**
 * The highest trigger count a rung may sit at. Same reasoning as `WARN_PUNISHMENT_MAX_WARNS`: it is what stops
 * the editor being handed a rung nobody's count will ever reach.
 */
export const TRIGGER_PUNISHMENT_MAX_TRIGGERS = 100;

/**
 * The smallest burst anti-spam can be configured to catch (P5c, feature 07). Two messages, because one message
 * is not a burst -- a threshold of 1 would delete every message in the server, and legacy would have let a guild
 * set it. Mirrors the `automoderator_guild_settings_antispam_check` CHECK, which is the one that cannot be
 * bypassed; this is the one the dashboard says out loud before anyone submits.
 */
export const ANTISPAM_MIN_AMOUNT = 2;

/**
 * The largest burst anti-spam can be configured to catch. Ours, not Discord's: the burst is deleted in one bulk
 * call, and Discord's bulk-delete endpoint takes at most a hundred messages, so a higher threshold would
 * configure a punishment the bot can only partly carry out.
 */
export const ANTISPAM_MAX_AMOUNT = 100;

/**
 * The longest anti-spam window, in seconds. Five minutes, past which "N messages in the window" stops being a
 * statement about spam and becomes one about how talkative somebody is. Also bounds the redis sorted set the
 * counter lives in, which holds one entry per message per member for exactly this long.
 */
export const ANTISPAM_MAX_SECONDS = 300;

/**
 * The longest a filter trigger can be configured to take to fall off a member's count (P5c, feature 11), in
 * minutes -- thirty days, past which "triggers never expire" is what the guild actually means and `NULL` says it
 * directly. Same shape and the same reasoning as `AUTO_PARDON_MAX_DAYS`.
 */
export const TRIGGER_DECAY_MAX_MINUTES = 30 * 24 * 60;

/**
 * When the read-only archive of legacy's banned words goes away (#11 P9).
 *
 * Banned words do not migrate -- each guild rebuilds its keyword lists in Server Settings after cutover -- so
 * `automoderator_legacy_banwords` keeps a copy of what the list used to be for three months, because after P9
 * tears down `postgres-old` nothing else has it. The dashboard renders this date on the archive card so nobody
 * discovers the deadline by the data being gone.
 *
 * An ISO date rather than a duration from an unrecorded cutover: the retention is a single calendar fact about
 * one table, and the thing that actually ends it is the operator running the `DROP TABLE` in the P9 runbook.
 */
export const LEGACY_BANWORD_ARCHIVE_UNTIL = '2026-12-22';

/**
 * The oldest an account can be required to be before the join gate (P6, feature 13) lets it in, in seconds.
 * A year, past which a gate stops being a raid measure and becomes a membership policy Discord's own
 * verification levels express better. Legacy had no ceiling at all, in a column measured in milliseconds.
 */
export const MIN_JOIN_AGE_MAX_SECONDS = 365 * 24 * 60 * 60;

/**
 * How long one punishment notice (#232 P3b) may be -- the text a guild appends to the DM the bot sends when it
 * warns, mutes, kicks, softbans or bans somebody.
 *
 * A thousand characters against Discord's 2000-character message: the notice shares that message with the line
 * naming the action and the guild, and with a reason that is itself capped at 400. Anything longer is a rules
 * page, and a rules page belongs behind the link the notice carries rather than inside a DM.
 */
export const PUNISHMENT_NOTICE_MAX_LENGTH = 1_000;

/**
 * The default appeal questionnaire (#232, P1). A guild's `appeal_questions` rows are seeded from this the
 * first time it saves an Appeals config, so every guild has real, editable rows from day one and P7's
 * questionnaire editor is plain CRUD over them rather than a migration that invents history.
 *
 * Here rather than beside the API's insert because three surfaces render the same prompts: `unban.app`'s
 * form, the mod-channel embed's field names, and the dashboard's read-only preview of the set.
 */
export const DEFAULT_APPEAL_QUESTIONS = [
	{ prompt: 'Why were you banned?', required: true },
	{ prompt: 'Why do you believe the ban should be lifted?', required: true },
	{ prompt: 'What will you do differently if you are let back in?', required: true },
	{ prompt: 'Anything else the moderators should know?', required: false },
] as const satisfies readonly { prompt: string; required: boolean }[];

/**
 * How many questions one guild's appeal form may hold, and how long a prompt and an answer may be.
 *
 * All three are Discord's limits rather than ours, because decision 13 says an appeal is **one** embed: an
 * answer becomes an embed field value (1024) and its prompt becomes that field's name (256).
 *
 * **The count is not what keeps the embed postable**, though an earlier version of this comment claimed it
 * was: five questions at full length are 5 * 1280 = 6400 against a 6000-character *message*, so the arithmetic
 * never worked. `buildAppealEmbed` budgets the whole embed and trims answers to fit; this is a product cap on
 * how long a form a guild may ask somebody to fill in, and a sixth question would be answered by the trimming
 * rather than by a failure.
 */
export const APPEAL_QUESTION_MAX_COUNT = 5;

export const APPEAL_QUESTION_PROMPT_MAX_LENGTH = 256;

export const APPEAL_ANSWER_MAX_LENGTH = 1_024;

/**
 * The longest a denial reason (or a silent denial's mod-only note) may be, in characters.
 *
 * Ours rather than Discord's: it renders inside the appeal card's description alongside the ban reason, and on
 * an ordinary denial it is also what P6 puts in the DM the appellant receives. A reason that needs more than
 * this is a conversation, and the appeal thread is where that goes.
 */
export const APPEAL_DECISION_REASON_MAX_LENGTH = 500;

/**
 * The longest a guild may make its re-appeal cooldown, in days. A year, past which "you may not appeal again"
 * is what the guild actually means and the manual unappealable list says it directly. `0` is a real value --
 * it means an appellant may resubmit as soon as a decision lands, which is what a guild running a fast triage
 * queue wants.
 */
export const APPEAL_COOLDOWN_MAX_DAYS = 365;

/**
 * The hard ceiling a guild may put on appeals per (user, punishment), independent of the cooldown. Ours: this
 * exists to stop one appellant re-filing forever, and a guild that wants more than ten attempts on record is
 * expressing a cooldown, not a ceiling. `NULL` (no ceiling) stays the default.
 */
export const APPEAL_MAX_APPEALS_CEILING = 10;
