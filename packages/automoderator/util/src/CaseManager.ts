import { kLogger, kRedis } from '@automoderator/injection';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest } from '@cordis/rest';
import { Case, CaseAction, PrismaClient, WarnPunishmentAction } from '@prisma/client';
import {
	APIGuild,
	APIGuildMember,
	APIRole,
	RESTPatchAPIGuildMemberJSONBody,
	RESTPutAPIGuildBanJSONBody,
	Routes,
} from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import { dmUser } from './dmUser';
import { Log, LogTypes } from '@automoderator/broker-types';
import type { Redis } from 'ioredis';
import ms from '@naval-base/ms';

type TransactionPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>;

export interface BaseCaseCreateData<Action extends CaseAction = CaseAction> {
	guildId: string;
	refId?: number;
	targetId: string;
	targetTag: string;
	mod?: {
		id: string;
		tag: string;
	};
	actionType: Action;
	reason?: string;
	notifyUser?: boolean;
	applyAction?: boolean;
}

export type DurationCaseType = 'ban' | 'mute';
export type DeleteDaysCaseType = 'ban' | 'softban';

export type OtherCaseType = Exclude<CaseAction, DurationCaseType | DeleteDaysCaseType>;
export type OtherCaseData = BaseCaseCreateData<OtherCaseType>;

export interface DurationCaseData<Action extends DurationCaseType = DurationCaseType>
	extends BaseCaseCreateData<Action> {
	expiresAt?: Date;
}

export interface DeleteDaysCaseData<Action extends DeleteDaysCaseType = DeleteDaysCaseType>
	extends BaseCaseCreateData<Action> {
	deleteDays?: number;
}

export interface BanCaseData extends DurationCaseData<'ban'>, DeleteDaysCaseData<'ban'> {}

export interface SoftbanCaseData extends DeleteDaysCaseData<'softban'> {}

export interface MuteCaseData extends DurationCaseData<'mute'> {
	/**
	 * Null implies the usage of timeouts
	 */
	unmuteRoles?: string[] | null;
}

export type CaseData = OtherCaseData | BanCaseData | SoftbanCaseData | MuteCaseData;

@singleton()
export class CaseManager {
	public constructor(
		public readonly prisma: PrismaClient,
		public readonly rest: Rest,
		public readonly logs: PubSubPublisher<Log>,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kRedis) public readonly redis: Redis,
	) {}

	// TODO(DD): Figure out a better way to handle this schema-wise;
	// TODO(DD): used to be an sql function used on insert but prisma doesn't play with those at all.
	// TODO(DD): this is more than sub-optimal, esp. without caching, but won't be an issue short-term.
	public async getNextCaseId(guildId: string, prisma: TransactionPrisma = this.prisma): Promise<number> {
		return (
			((
				await prisma.case.findFirst({
					where: {
						guildId,
					},
					orderBy: {
						caseId: 'desc',
					},
				})
			)?.caseId ?? 0) + 1
		);
	}

	public async makeWarnTriggerCase(cs: Case, prisma: TransactionPrisma = this.prisma): Promise<Case | null> {
		const userWarns = await prisma.case.findMany({ where: { targetId: cs.targetId, guildId: cs.guildId } });
		const warnPunishment = await prisma.warnPunishment.findFirst({
			where: { guildId: cs.guildId, warns: userWarns.length },
		});

		if (!warnPunishment) {
			return null;
		}

		return this.internalCreate(
			{
				guildId: cs.guildId,
				refId: cs.caseId,
				targetId: cs.targetId,
				targetTag: cs.targetTag,
				mod:
					cs.modId && cs.modTag
						? {
								id: cs.modId,
								tag: cs.modTag,
						  }
						: undefined,
				actionType: warnPunishment.actionType,
				expiresAt:
					warnPunishment.actionType === WarnPunishmentAction.ban ||
					warnPunishment.actionType === WarnPunishmentAction.mute
						? new Date(Date.now() + Number(warnPunishment.duration))
						: undefined,
				reason: `Automatic punishment triggered for reaching ${userWarns.length} warnings`,
			},
			prisma,
		);
	}

	private async dataFromCase(cs: Case, prisma: TransactionPrisma = this.prisma): Promise<CaseData> {
		return {
			guildId: cs.guildId,
			refId: cs.refId ?? undefined,
			targetId: cs.targetId,
			targetTag: cs.targetTag,
			mod:
				cs.modId && cs.modTag
					? {
							id: cs.modId,
							tag: cs.modTag,
					  }
					: undefined,
			reason: cs.reason ?? undefined,
			expiresAt: cs.expiresAt ?? undefined,
			unmuteRoles: cs.useTimeouts
				? null
				: (await prisma.unmuteRole.findMany({ where: { caseId: cs.id } })).map((u) => u.roleId),
			actionType: cs.actionType,
		};
	}

	private async internalCreate(data: CaseData, prisma: TransactionPrisma) {
		return prisma.case.create({
			data: {
				guildId: data.guildId,
				caseId: await this.getNextCaseId(data.guildId, prisma),
				refId: data.refId,
				targetId: data.targetId,
				targetTag: data.targetTag,
				modId: data.mod?.id,
				modTag: data.mod?.tag,
				actionType: data.actionType,
				reason: data.reason,
				expiresAt:
					data.actionType === CaseAction.ban || data.actionType === CaseAction.mute ? data.expiresAt : undefined,
				useTimeouts: data.actionType === CaseAction.mute ? data.unmuteRoles === null : false,
				unmuteRoles:
					data.actionType === CaseAction.mute && data.unmuteRoles
						? {
								createMany: {
									data: data.unmuteRoles.map((roleId) => ({ roleId })),
								},
						  }
						: undefined,
				task:
					(data.actionType === CaseAction.ban || data.actionType === CaseAction.mute) && data.expiresAt
						? {
								create: {
									task: {
										create: {
											guildId: data.guildId,
											runAt: data.expiresAt,
										},
									},
								},
						  }
						: undefined,
			},
		});
	}

	private async handlePunishment(cs: Case, data: CaseData, prisma: TransactionPrisma = this.prisma): Promise<unknown> {
		switch (data.actionType) {
			case CaseAction.warn: {
				return;
			}

			case CaseAction.mute: {
				if (cs.useTimeouts) {
					return this.rest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(
						Routes.guildMember(cs.guildId, cs.targetId),
						{
							data: {
								communication_disabled_until: cs.expiresAt?.toISOString(),
							},
						},
					);
				}

				const settings = await prisma.guildSettings.findFirst({
					where: { guildId: cs.guildId },
					rejectOnNotFound: true,
				});
				const member = await this.rest.get<APIGuildMember>(Routes.guildMember(cs.guildId, cs.targetId));
				const rawRoles = await this.rest.get<APIRole[]>(Routes.guildRoles(cs.guildId));
				const roles = new Map(rawRoles.map((r) => [r.id, r]));

				const muteRoles = [settings.muteRole!];
				const unmuteRoles: string[] = [];

				for (const role of member.roles) {
					if (roles.has(role)) {
						if (!roles.get(role)!.managed) {
							unmuteRoles.push(role);
						}
					} else {
						this.logger.warn({ role }, 'Role was not found when doing GET /guilds/:id/roles while muting user');
						muteRoles.push(role);
					}
				}

				await prisma.unmuteRole.createMany({
					data: unmuteRoles.map((r) => ({ caseId: cs.id, roleId: r })),
				});
				return this.rest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(cs.guildId, cs.targetId), {
					data: {
						roles: muteRoles,
					},
				});
			}

			case 'unmute': {
				if (cs.useTimeouts) {
					return this.rest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(
						Routes.guildMember(cs.guildId, cs.targetId),
						{
							data: {
								communication_disabled_until: null,
							},
						},
					);
				}

				const member = await this.rest.get<APIGuildMember>(Routes.guildMember(cs.guildId, cs.targetId));
				const rawRoles = await this.rest.get<APIRole[]>(Routes.guildRoles(cs.guildId));
				const roles = new Map(rawRoles.map((r) => [r.id, r]));
				const baseRoles = member.roles.filter((r) => roles.has(r) && !roles.get(r)!.managed);

				const unmuteRoles = await prisma.unmuteRole.findMany({ where: { caseId: cs.id } });
				return this.rest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(cs.guildId, cs.targetId), {
					data: {
						roles: baseRoles.concat(unmuteRoles.map((r) => r.roleId)),
					},
				});
			}

			case 'kick': {
				return this.rest.delete(Routes.guildMember(cs.guildId, cs.targetId));
			}

			case 'softban': {
				await this.rest.put<unknown, RESTPutAPIGuildBanJSONBody>(Routes.guildBan(cs.guildId, cs.targetId), {
					data: {
						delete_message_days: data.deleteDays ?? 1,
					},
				});
				return this.rest.delete(Routes.guildBan(cs.guildId, cs.targetId));
			}

			case 'ban': {
				return this.rest.put<unknown, RESTPutAPIGuildBanJSONBody>(Routes.guildBan(cs.guildId, cs.targetId), {
					data: {
						delete_message_days: data.deleteDays,
					},
				});
			}

			case 'unban': {
				return this.rest.delete(Routes.guildBan(cs.guildId, cs.targetId));
			}
		}
	}

	private getReversalAction(actionType: CaseAction): CaseAction {
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

	private async notifyUser(cs: Case) {
		const guild = await this.rest.get<APIGuild>(Routes.guild(cs.guildId));
		await dmUser(
			cs.targetId,
			`You have been ${this.formatActionName(cs.actionType)} in ${guild.name}${
				cs.expiresAt ? ` for ${ms(cs.expiresAt.getTime() - Date.now(), true)}` : ''
			}.${cs.reason ? `\n\nReason: ${cs.reason}` : ''}`,
			cs.guildId,
		);
	}

	private async lock(cs: Case): Promise<void> {
		const key = `case_locks:${cs.actionType}:${cs.targetId}`;
		const fiveMinutes = 300000;
		await this.redis.set(key, cs.id, 'PX', fiveMinutes);
	}

	public async isLocked(actionType: CaseAction, targetId: string): Promise<Case | null> {
		const key = `case_locks:${actionType}:${targetId}`;
		const lockedCaseId = await this.redis.get(key);
		if (lockedCaseId) {
			return this.prisma.case.findFirst({ where: { id: parseInt(lockedCaseId, 10) }, rejectOnNotFound: true });
		}

		return null;
	}

	public create(data: CaseData): Promise<[cs: Case, warnTrigger?: Case]> {
		data.notifyUser ??= true;
		data.applyAction ??= true;

		return this.prisma.$transaction<[Case, Case?]>(async (prisma) => {
			const cs = await this.internalCreate(data, prisma);
			if (data.notifyUser) {
				await this.notifyUser(cs);
			}
			if (data.applyAction) {
				await this.handlePunishment(cs, data, prisma);
			}

			const cases: [Case, Case?] = [cs];

			if (data.actionType === CaseAction.warn) {
				const triggeredCase = await this.makeWarnTriggerCase(cs, prisma);
				if (triggeredCase) {
					if (data.notifyUser) {
						await this.notifyUser(cs);
					}
					if (data.applyAction) {
						await this.handlePunishment(cs, await this.dataFromCase(cs), prisma);
					}
					cases.push(triggeredCase);
				}
			}

			for (const cs of cases) {
				await this.lock(cs!);
			}

			this.logs.publish({
				type: LogTypes.modAction,
				data: cases as Case[],
			});

			return cases;
		});
	}

	public async undoTimedAction(cs: Case): Promise<Case> {
		const [undone] = await this.create({
			actionType: this.getReversalAction(cs.actionType),
			guildId: cs.guildId,
			targetId: cs.targetId,
			targetTag: cs.targetTag,
			mod:
				cs.modId && cs.modTag
					? {
							id: cs.modId,
							tag: cs.modTag,
					  }
					: undefined,
			reason: 'Automated timed action expiry',
			refId: cs.caseId,
		});

		return undone;
	}
}
