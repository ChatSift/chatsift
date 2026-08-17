/**
 * Shared limits for the mod commands' options, so the seven builders can't drift from each other or from what
 * the database and Discord actually accept.
 */

export const REASON_MAX_LENGTH = 400;

export const MAX_DELETE_MESSAGE_DAYS = 7;

export const SECONDS_PER_DAY = 86_400;
