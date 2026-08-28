// Order is load-bearing for presentation only (the dashboard's guild nav and the homepage's bot grid both
// map over this). 'SOCIAL' (#343) is a real BotId from its API phase onward -- what it does *not* have yet is
// public marketing copy, which is why `apps/website`'s `marketingBots` is a partial record keyed off this and
// the public pages render only the bots that have an entry (see that file). 'AUTOMODERATOR' is in the same
// position from the port's P0 onward (docs/roadmap/11-automoderator-port.md).
//
// Spelled 'AUTOMODERATOR', not 'AUTOMOD': the port makes our filter subsystem talk to *Discord's* AutoMod
// constantly, and the two are different things. Keeping the product's name unabbreviated is what stops that
// ambiguity from becoming permanent in log lines, metric labels and Redis keys.
export const BOTS = ['AMA', 'MODMAIL', 'SOCIAL', 'AUTOMODERATOR'] as const;

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
 * Carries the WS gateway's per-tab `realtimeClientId` (`apps/website/src/api/realtimeClientId.ts`) on an HTTP
 * mutation request, so `services/api/src/core/server.ts`'s `realtimeChannel` broadcast hook can tag the
 * resulting invalidate signal with which browser tab caused it -- see that file's doc comment for why this has
 * to be a value separate from the session's user id.
 */
export const RealtimeClientIdHeader = 'X-Realtime-Client-Id' as const;

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
