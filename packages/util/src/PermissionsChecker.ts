import { DiscordPermissions } from '@automoderator/broker-types';
import { Config, kConfig, kLogger } from '@automoderator/injection';
import { REST } from '@discordjs/rest';
import { PrismaClient } from '@prisma/client';
import type { APIInteractionGuildMember, RESTGetAPIGuildResult, Snowflake } from 'discord-api-types/v9';
import { Routes } from 'discord-api-types/v9';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';

export enum UserPerms {
	none,
	mod,
	admin,
	owner,
}

export type PermissionsCheckerData = {
	guild_id: Snowflake;
	member: APIInteractionGuildMember;
};

@singleton()
export class PermissionsChecker {
	public constructor(
		public readonly prisma: PrismaClient,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kConfig) public readonly config: Config,
		public readonly rest: REST,
	) {}

	public checkAdmin(data: PermissionsCheckerData): boolean {
		return new DiscordPermissions(BigInt(data.member.permissions)).has('manageGuild', true);
	}

	public async checkOwner(data: PermissionsCheckerData, ownerId?: Snowflake | null): Promise<boolean> {
		if (!ownerId) {
			const guild = (await this.rest.get(Routes.guild(data.guild_id)).catch((error: unknown) => {
				this.logger.warn({ error }, 'Failed a checkOwner guild fetch - returning false');
				return null;
			})) as RESTGetAPIGuildResult | null;

			if (!guild) {
				return false;
			}

			// eslint-disable-next-line no-param-reassign
			ownerId = guild.owner_id;
		}

		return data.member.user.id === ownerId;
	}

	public async check(data: PermissionsCheckerData, perm: UserPerms, ownerId?: Snowflake | null): Promise<boolean> {
		if (this.config.devIds.includes(data.member.user.id) || this.config.discordClientId === data.member.user.id) {
			return true;
		}

		switch (perm) {
			case UserPerms.none: {
				return true;
			}

			// Checks are in order of speed (simple bitfield math OR query -> db query + array includes -> HTTP call and string comparison)
			case UserPerms.mod: {
				return this.checkAdmin(data) || this.checkOwner(data, ownerId);
			}

			case UserPerms.admin: {
				return this.checkAdmin(data) || this.checkOwner(data, ownerId);
			}

			case UserPerms.owner: {
				return this.checkOwner(data, ownerId);
			}

			default:
				return false;
		}
	}
}
