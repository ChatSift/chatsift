import type { AutomoderatorCaseAction } from '@chatsift/db';

export const CASE_ACTION = {
	WARN: 'WARN' as AutomoderatorCaseAction,
	MUTE: 'MUTE' as AutomoderatorCaseAction,
	UNMUTE: 'UNMUTE' as AutomoderatorCaseAction,
	KICK: 'KICK' as AutomoderatorCaseAction,
	SOFTBAN: 'SOFTBAN' as AutomoderatorCaseAction,
	BAN: 'BAN' as AutomoderatorCaseAction,
	UNBAN: 'UNBAN' as AutomoderatorCaseAction,
} as const satisfies Record<string, AutomoderatorCaseAction>;

export const CASE_ACTIONS: readonly AutomoderatorCaseAction[] = Object.values(CASE_ACTION);
