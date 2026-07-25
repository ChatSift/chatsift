import type { APIGuildMember, APIUser } from '@discordjs/core';

export interface TemplateData {
	guildName: string;
	joinDate?: string;
	userId?: string;
	username?: string;
}

/**
 * Same placeholder set/format (`{{ name }}`) as prod ChatSift/ModMail's `templateString.ts`, minus
 * `roles` (not worth an extra guild-roles fetch just for a greeting/farewell template variable).
 * Lets a dashboard-authored greeting reference who's opening the ticket instead of always being
 * static text.
 */
export function templateDataFromMember(
	guildName: string,
	member: Pick<APIGuildMember, 'joined_at'>,
	user: APIUser,
): TemplateData {
	const joinDate = member.joined_at ? `<t:${Math.floor(new Date(member.joined_at).getTime() / 1_000)}:D>` : 'unknown';

	return {
		guildName,
		joinDate,
		userId: user.id,
		username: user.username,
	};
}

export function templateString(content: string, data: TemplateData): string {
	return content.replaceAll(
		/{{ (?<template>\w+?) }}/gm,
		(_, template: string) => data[template as keyof TemplateData] ?? `[unknown template ${template}]`,
	);
}

/**
 * Used for the anon-reply author label (`lib/relay.ts`), which only has a guild to template with —
 * no member/user in scope the way a greeting has.
 */
export function templateGuildName(content: string, guildName: string): string {
	return templateString(content, { guildName });
}
