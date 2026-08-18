import { getContext } from './context.js';

/**
 * Links from Discord into the dashboard, shared by `services/automoderator-bot` (every embed that offers one)
 * and `services/api` (the DM report card it posts at P3b).
 *
 * `FRONTEND_URL` comes straight off the environment and is not normalized there, so the trailing slash has to be
 * dealt with here rather than at each call site — `https://chatsift.com//dashboard/...` is a link that works
 * until someone puts it behind a redirect that cares.
 *
 * **These belong in an embed's description, never its footer.** Discord renders no markdown at all in a footer,
 * so a link there is unclickable text — found the hard way when `/history`'s link was first written into one.
 */
function frontend(): string {
	return getContext().FRONTEND_URL.replace(/\/$/, '');
}

export function caseBrowserLink(guildId: string, targetId?: string): string {
	const base = `${frontend()}/dashboard/${guildId}/automoderator/cases`;

	return targetId ? `${base}?search=${targetId}` : base;
}

export function publicHistoryLink(token: string): string {
	return `${frontend()}/automoderator/history/${token}`;
}

export function reportDetailLink(guildId: string, reportId: number): string {
	return `${frontend()}/dashboard/${guildId}/automoderator/reports/${reportId}`;
}

export function reportDraftLink(token: string): string {
	return `${frontend()}/automoderator/report/${token}`;
}
