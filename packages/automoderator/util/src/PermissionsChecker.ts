import { GuildSettings, PrismaClient } from '@prisma/client';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { APIInteractionGuildMember, RESTGetAPIGuildResult, Routes, Snowflake } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import { DiscordPermissions } from '@chatsift/api-wrapper';

export enum UserPerms {
	none,
	mod,
	admin,
	owner,
}

export interface PermissionsCheckerData {
	member: APIInteractionGuildMember;
	guild_id: Snowflake;
}

@singleton()
export class PermissionsChecker {
	public constructor(
		public readonly prisma: PrismaClient,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kConfig) public readonly config: Config,
		public readonly rest: Rest,
	) {}

	public async checkMod(data: PermissionsCheckerData, settings?: GuildSettings | null): Promise<boolean> {
		if (!settings) {
			settings = await this.prisma.guildSettings.findFirst({ where: { guildId: data.guild_id } });
		}

		if (!settings?.modRole) {
			return false;
		}

		return data.member.roles.includes(settings.modRole);
	}

	public async checkAdmin(data: PermissionsCheckerData, settings?: GuildSettings | null): Promise<boolean> {
		if (new DiscordPermissions(BigInt(data.member.permissions)).has('manageGuild', true)) {
			return true;
		}

		if (!settings) {
			settings = await this.prisma.guildSettings.findFirst({ where: { guildId: data.guild_id } });
		}

		if (!settings?.adminRole) {
			return false;
		}

		return data.member.roles.includes(settings.adminRole);
	}

	public async checkOwner(data: PermissionsCheckerData, ownerId?: Snowflake | null): Promise<boolean> {
		if (!ownerId) {
			const guild = await this.rest.get<RESTGetAPIGuildResult>(Routes.guild(data.guild_id)).catch((error: unknown) => {
				this.logger.warn({ error }, 'Failed a checkOwner guild fetch - returning false');
				return null;
			});

			if (!guild) {
				return false;
			}

			ownerId = guild.owner_id;
		}

		return data.member.user.id === ownerId;
	}

	public async check(
		data: PermissionsCheckerData,
		perm: UserPerms,
		settings?: GuildSettings | null,
		ownerId?: Snowflake | null,
	): Promise<boolean> {
		if (this.config.devIds.includes(data.member.user.id) || this.config.discordClientId === data.member.user.id) {
			return true;
		}

		if (!settings) {
			settings = await this.prisma.guildSettings.findFirst({ where: { guildId: data.guild_id } });
		}

		switch (perm) {
			case UserPerms.none: {
				return true;
			}

			// Checks are in order of speed (simple bitfield math OR query -> db query + array includes -> HTTP call and string comparison)
			case UserPerms.mod: {
				return (
					(await this.checkAdmin(data, settings)) ||
					(await this.checkMod(data, settings)) ||
					this.checkOwner(data, ownerId)
				);
			}

			case UserPerms.admin: {
				return (await this.checkAdmin(data, settings)) || this.checkOwner(data, ownerId);
			}

			case UserPerms.owner: {
				return this.checkOwner(data, ownerId);
			}
		}
	}
}
