import { REST } from '@discordjs/rest';
import ms from '@naval-base/ms';
import { CaseAction, PrismaClient } from '@prisma/client';
import type { Case } from '@prisma/client';
import type {
	APIGuild,
	APIGuildMember,
	APIRole,
	RESTPatchAPIGuildMemberJSONBody,
	RESTPutAPIGuildBanJSONBody,
} from 'discord-api-types/v10';
import { Routes } from 'discord-api-types/v10';
import Redis from 'ioredis';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import { dmUser } from '../util/dmUser';
import { SYMBOLS } from '../util/symbols';

@singleton()
export class CaseManager {
	public constructor(
		@inject(SYMBOLS.redis) private readonly redis: Redis,
		private readonly prisma: PrismaClient,
		private readonly rest: REST,
		@inject(SYMBOLS.logger) private readonly logger: Logger,
	) {}

	/**
	 * Claims the lock on a guild-user pair given a created case
	 */
	public async lock(cs: Case): Promise<void> {
		const key = `case_locks:${cs.targetId}:${cs.guildId}`;
		const fiveMinutes = 300_000;
		await this.redis.set(key, cs.id, 'PX', fiveMinutes);
	}

	/**
	 * Looks up a lock with the given guild-user pair
	 */
	public async getLock(targetId: string, guildId: string): Promise<Case | null> {
		const key = `case_locks:${targetId}:${guildId}`;
		const lockedCaseId = await this.redis.get(key);
		if (!lockedCaseId) {
			return null;
		}

		return this.prisma.case.findFirst({ where: { id: Number.parseInt(lockedCaseId, 10) } });
	}

	public formatActionName(actionType: CaseAction): string {
		return (
			{
				[CaseAction.warn]: 'warned',
				[CaseAction.mute]: 'muted',
				[CaseAction.unmute]: 'unmuted',
				[CaseAction.kick]: 'kicked',
				[CaseAction.softban]: 'softbanned',
				[CaseAction.ban]: 'banned',
				[CaseAction.unban]: 'unbanned',
			} as const
		)[actionType];
	}

	public async notifyUser(cs: Case) {
		const guild = (await this.rest.get(Routes.guild(cs.guildId))) as APIGuild;
		return dmUser(
			cs.targetId,
			`You have been ${this.formatActionName(cs.actionType)} in ${guild.name}${
				cs.expiresAt ? ` for ${ms(cs.expiresAt.getTime() - Date.now(), true)}` : ''
			}.${cs.reason ? `\n\nReason: ${cs.reason}` : ''}`,
			cs.guildId,
		);
	}

	public getReversalAction(actionType: CaseAction): CaseAction {
		switch (actionType) {
			case CaseAction.ban: {
				return CaseAction.unban;
			}

			case CaseAction.mute: {
				return CaseAction.unmute;
			}

			default: {
				throw new Error('Invalid action type for reversal');
			}
		}
	}

	public async applyPunishment(cs: Case) {
		switch (cs.actionType) {
			case CaseAction.warn: {
				return;
			}

			case CaseAction.mute: {
				if (cs.useTimeouts) {
					const body: RESTPatchAPIGuildMemberJSONBody = { communication_disabled_until: cs.expiresAt?.toISOString() };

					return this.rest.patch(Routes.guildMember(cs.guildId, cs.targetId), { body });
				}

				const settings = await this.prisma.guildSettings.findFirst({
					where: { guildId: cs.guildId },
					rejectOnNotFound: true,
				});
				const member = (await this.rest.get(Routes.guildMember(cs.guildId, cs.targetId))) as APIGuildMember;
				const rawRoles = (await this.rest.get(Routes.guildRoles(cs.guildId))) as APIRole[];
				const roles = new Map(rawRoles.map((role) => [role.id, role]));

				const muteRoles = [settings.muteRole!];
				const unmuteRoles: string[] = [];

				for (const role of member.roles) {
					if (roles.has(role)) {
						if (roles.get(role)!.managed) {
							muteRoles.push(role);
						} else {
							unmuteRoles.push(role);
						}
					} else {
						this.logger.warn({ role }, 'Role was not found when doing GET /guilds/:id/roles while muting user');
						muteRoles.push(role);
					}
				}

				await this.prisma.unmuteRole.createMany({
					data: unmuteRoles.map((role) => ({
						caseId: cs.id,
						roleId: role,
					})),
				});
				const body: RESTPatchAPIGuildMemberJSONBody = { roles: muteRoles };

				return this.rest.patch(Routes.guildMember(cs.guildId, cs.targetId), { body });
			}

			case CaseAction.unmute: {
				if (cs.useTimeouts) {
					const body: RESTPatchAPIGuildMemberJSONBody = { communication_disabled_until: null };

					return this.rest.patch(Routes.guildMember(cs.guildId, cs.targetId), { body });
				}

				const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: cs.guildId } });
				const member = (await this.rest.get(Routes.guildMember(cs.guildId, cs.targetId))) as APIGuildMember;
				const baseRoles = member.roles.filter((role) => role !== settings?.muteRole);

				const unmuteRoles = await this.prisma.unmuteRole.findMany({ where: { caseId: cs.id } });
				const body: RESTPatchAPIGuildMemberJSONBody = {
					roles: baseRoles.concat(unmuteRoles.map((role) => role.roleId)),
				};
				return this.rest.patch(Routes.guildMember(cs.guildId, cs.targetId), { body });
			}

			case CaseAction.kick: {
				return this.rest.delete(Routes.guildMember(cs.guildId, cs.targetId));
			}

			case CaseAction.softban: {
				const body: RESTPutAPIGuildBanJSONBody = { delete_message_days: cs.deleteDays ?? 1 };
				await this.rest.put(Routes.guildBan(cs.guildId, cs.targetId), { body });
				return this.rest.delete(Routes.guildBan(cs.guildId, cs.targetId));
			}

			case CaseAction.ban: {
				const body: RESTPutAPIGuildBanJSONBody = { delete_message_days: cs.deleteDays ?? undefined };
				return this.rest.put(Routes.guildBan(cs.guildId, cs.targetId), { body });
			}

			case CaseAction.unban: {
				return this.rest.delete(Routes.guildBan(cs.guildId, cs.targetId));
			}

			default: {
				throw new Error(`Unknown action type: ${cs.actionType}`);
			}
		}
	}
}
