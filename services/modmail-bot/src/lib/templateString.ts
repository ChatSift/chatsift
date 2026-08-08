import type { APIGuildMember, APIUser } from '@discordjs/core';

export interface TemplateData {
	guildName: string;
	joinDate?: string;
	userId?: string;
	username?: string;
}

/**
 * Lets a dashboard-authored greeting/farewell reference who's opening the ticket instead of always
 * being static text, via a `{{name}}` placeholder. ChatSift/ModMail's own template syntax also
 * supported a `roles` placeholder; deliberately not carried over here — not worth an extra
 * guild-roles fetch just for a template variable.
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
		// Tolerates optional whitespace around the name so already-saved guild configs authored under the
		// old `{{ name }}` hint text keep resolving, even though the dashboard now documents/writes `{{name}}`.
		/{{\s*(?<template>\w+?)\s*}}/gm,
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
