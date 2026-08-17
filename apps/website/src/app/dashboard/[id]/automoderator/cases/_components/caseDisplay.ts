/**
 * Display helpers shared by the case list and the case detail, so the two can't disagree about what a case
 * looks like. Same split as the ModMail thread views' `util.ts`.
 */

/**
 * Mirrors `CREATE TYPE automoderator_case_action`, in the order the filter dropdown should list them.
 */
export const CASE_ACTIONS = ['WARN', 'MUTE', 'UNMUTE', 'KICK', 'SOFTBAN', 'BAN', 'UNBAN'] as const;

export const ACTION_LABELS: Record<string, string> = {
	WARN: 'Warn',
	MUTE: 'Mute',
	UNMUTE: 'Unmute',
	KICK: 'Kick',
	SOFTBAN: 'Softban',
	BAN: 'Ban',
	UNBAN: 'Unban',
};

/**
 * Pill classes per action severity. Only tokens from `styles/globals.css`'s `@theme` block -- Tailwind's
 * default palette is disabled in this app (`--color-*: initial`), so `bg-red-500` would compile to nothing.
 *
 * `misc-warning`/`misc-system` carry `-dark` variants that do **not** apply automatically, hence the explicit
 * `dark:` halves; `misc-danger`/`misc-accent` are single values that work in both themes.
 */
export const ACTION_PILL_CLASSES: Record<string, string> = {
	BAN: 'bg-misc-danger/10 text-misc-danger',
	SOFTBAN: 'bg-misc-danger/10 text-misc-danger',
	KICK: 'bg-misc-warning/10 text-misc-warning dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark',
	MUTE: 'bg-misc-warning/10 text-misc-warning dark:bg-misc-warning-dark/10 dark:text-misc-warning-dark',
	WARN: 'bg-misc-system/10 text-misc-system dark:bg-misc-system-dark/10 dark:text-misc-system-dark',
	UNMUTE: 'bg-misc-accent/10 text-misc-accent',
	UNBAN: 'bg-misc-accent/10 text-misc-accent',
};
