import { DiscordPermissions } from '@automoderator/broker-types';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { Rest } from '@cordis/rest';
import { PrismaClient } from '@prisma/client';
import { APIInteractionGuildMember, RESTGetAPIGuildResult, Routes, Snowflake } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

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

	public async checkMod(data: PermissionsCheckerData, modRoles?: Set<Snowflake> | null): Promise<boolean> {
		modRoles ??= new Set(
			(await this.prisma.modRole.findMany({ where: { guildId: data.guild_id } })).map((r) => r.roleId),
		);

		return data.member.roles.some((r) => modRoles?.has(r));
	}

	public async checkAdmin(data: PermissionsCheckerData, adminRoles?: Set<Snowflake> | null): Promise<boolean> {
		if (new DiscordPermissions(BigInt(data.member.permissions)).has('manageGuild', true)) {
			return true;
		}

		adminRoles ??= new Set(
			(await this.prisma.adminRole.findMany({ where: { guildId: data.guild_id } })).map((r) => r.roleId),
		);

		return data.member.roles.some((r) => adminRoles?.has(r));
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
		modRoles?: Set<Snowflake> | null,
		adminRoles?: Set<Snowflake> | null,
		ownerId?: Snowflake | null,
	): Promise<boolean> {
		if (this.config.devIds.includes(data.member.user.id) || this.config.discordClientId === data.member.user.id) {
			return true;
		}

		modRoles ??= new Set(
			(await this.prisma.modRole.findMany({ where: { guildId: data.guild_id } })).map((r) => r.roleId),
		);

		adminRoles ??= new Set(
			(await this.prisma.adminRole.findMany({ where: { guildId: data.guild_id } })).map((r) => r.roleId),
		);

		switch (perm) {
			case UserPerms.none: {
				return true;
			}

			// Checks are in order of speed (simple bitfield math OR query -> db query + array includes -> HTTP call and string comparison)
			case UserPerms.mod: {
				return (
					(await this.checkAdmin(data, adminRoles)) ||
					(await this.checkMod(data, modRoles)) ||
					this.checkOwner(data, ownerId)
				);
			}

			case UserPerms.admin: {
				return (await this.checkAdmin(data, adminRoles)) || this.checkOwner(data, ownerId);
			}

			case UserPerms.owner: {
				return this.checkOwner(data, ownerId);
			}
		}
	}
}
