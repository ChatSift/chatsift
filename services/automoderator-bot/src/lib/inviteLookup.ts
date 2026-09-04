import { guildBannerURL, guildIconURL, snowflakeTimestampSeconds } from '@chatsift/core';
import type { APIEmbed, APIInvite, APIInviteGuild } from '@discordjs/core';
import { GuildVerificationLevel } from '@discordjs/core';

/**
 * `/lookup-invite`'s embed (P6, feature 26). Pure, so the wording and the null handling are testable without a
 * REST client -- and there is a lot of null handling: almost every field of an invite is optional, and the ones
 * that matter most (the member counts) only arrive when they are asked for.
 *
 * What a moderator is deciding with this is whether the server behind an unfamiliar link is worth allowlisting
 * or worth banning the poster over, so the fields are the ones that answer that: how old it is, how big it is,
 * and what Discord already knows about it.
 */

const COLOR = 0x58_65_f2;

/**
 * Discord's own numbers, spelled out. Legacy printed the raw enum value, so a moderator read "Verification
 * level: 3" and had to go and look up what 3 meant.
 */
const VERIFICATION_LEVELS: Record<GuildVerificationLevel, string> = {
	[GuildVerificationLevel.None]: 'None',
	[GuildVerificationLevel.Low]: 'Low — verified email',
	[GuildVerificationLevel.Medium]: 'Medium — registered for 5 minutes',
	[GuildVerificationLevel.High]: 'High — member for 10 minutes',
	[GuildVerificationLevel.VeryHigh]: 'Highest — verified phone',
};

/**
 * How many of a guild's features to name before the list stops being information. A big server carries dozens,
 * and the tail is boosting perks nobody is reading a lookup for.
 */
const MAX_FEATURES = 12;

export type InviteWithGuild = APIInvite & { guild: APIInviteGuild };

export function hasGuild(invite: APIInvite): invite is InviteWithGuild {
	return invite.guild !== undefined;
}

export function buildInviteLookupEmbed(invite: InviteWithGuild): APIEmbed {
	const { guild } = invite;
	const created = snowflakeTimestampSeconds(guild.id);

	const fields: NonNullable<APIEmbed['fields']> = [
		{ name: 'Created', value: `<t:${created}:F>\n(<t:${created}:R>)`, inline: true },
		{
			name: 'Verification',
			value: VERIFICATION_LEVELS[guild.verification_level] ?? 'Unknown',
			inline: true,
		},
	];

	// Only present when the fetch asked for counts, and worth saying nothing about rather than printing a zero
	// that reads as an empty server.
	if (invite.approximate_member_count !== undefined) {
		const online =
			invite.approximate_presence_count === undefined ? '' : `\n${invite.approximate_presence_count} online`;
		fields.push({ name: 'Members', value: `${invite.approximate_member_count}${online}`, inline: true });
	}

	fields.push({
		name: 'Invite',
		value: [
			invite.channel ? `Channel: <#${invite.channel.id}> (#${invite.channel.name})` : 'Channel: unknown',
			invite.inviter ? `Created by: ${invite.inviter.username} (${invite.inviter.id})` : null,
			invite.expires_at
				? `Expires: <t:${Math.floor(new Date(invite.expires_at).getTime() / 1_000)}:R>`
				: 'Expires: never',
		]
			.filter((line) => line !== null)
			.join('\n'),
	});

	if (guild.vanity_url_code) {
		fields.push({ name: 'Vanity URL', value: `discord.gg/${guild.vanity_url_code}`, inline: true });
	}

	if (guild.features.length > 0) {
		const shown = guild.features.slice(0, MAX_FEATURES).join(', ');
		const rest = guild.features.length - MAX_FEATURES;
		fields.push({ name: 'Features', value: rest > 0 ? `${shown}, and ${rest} more` : shown });
	}

	const banner = guildBannerURL(guild.id, guild.banner);
	const icon = guildIconURL(guild.id, guild.icon);

	return {
		color: COLOR,
		author: { name: `${guild.name} (${guild.id})`, ...(icon ? { icon_url: icon } : {}) },
		...(guild.description ? { description: guild.description } : {}),
		...(banner ? { image: { url: banner } } : {}),
		fields,
		footer: { text: `discord.gg/${invite.code}` },
	};
}
