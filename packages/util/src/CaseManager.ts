import type { Log } from '@automoderator/broker-types';
import { LogTypes } from '@automoderator/broker-types';
import { kLogger, kRedis } from '@automoderator/injection';
import { PubSubPublisher } from '@cordis/brokers';
import { REST } from '@discordjs/rest';
import ms from '@naval-base/ms';
import type { Case } from '@prisma/client';
import { CaseAction, PrismaClient, WarnPunishmentAction } from '@prisma/client';
import type {
	APIGuild,
	APIGuildMember,
	APIRole,
	RESTPatchAPIGuildMemberJSONBody,
	RESTPutAPIGuildBanJSONBody,
} from 'discord-api-types/v9';
import { Routes } from 'discord-api-types/v9';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Redis } from 'ioredis';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { Logger } from 'pino';
import { inject, singleton } from 'tsyringe';
import { dmUser } from './dmUser';

type TransactionPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>;

export type BaseCaseCreateData<Action extends CaseAction = CaseAction> = {
	actionType: Action;
	applyAction?: boolean;
	guildId: string;
	mod?: {
		id: string;
		tag: string;
	};
	notifyUser?: boolean;
	reason?: string;
	refId?: number;
	targetId: string;
	targetTag: string;
};

export type DurationCaseType = 'ban' | 'mute' | 'unmute';
export type DeleteDaysCaseType = 'ban' | 'softban';

export type OtherCaseType = Exclude<CaseAction, DeleteDaysCaseType | DurationCaseType>;
export type OtherCaseData = BaseCaseCreateData<OtherCaseType>;

export type DurationCaseData<Action extends DurationCaseType = DurationCaseType> = BaseCaseCreateData<Action> & {
	expiresAt?: Date;
};

export type DeleteDaysCaseData<Action extends DeleteDaysCaseType = DeleteDaysCaseType> = BaseCaseCreateData<Action> & {
	deleteDays?: number;
};

export type BanCaseData = DeleteDaysCaseData<'ban'> & DurationCaseData<'ban'> & {};

export type SoftbanCaseData = DeleteDaysCaseData<'softban'> & {};

export type MuteCaseData = DurationCaseData<'mute' | 'unmute'> & {
	/**
	 * Null implies the usage of timeouts
	 */
	unmuteRoles?: string[] | null;
};

export type CaseData = BanCaseData | MuteCaseData | OtherCaseData | SoftbanCaseData;

@singleton()
export class CaseManager {
	public constructor(
		public readonly prisma: PrismaClient,
		public readonly rest: REST,
		public readonly logs: PubSubPublisher<Log>,
		@inject(kLogger) public readonly logger: Logger,
		@inject(kRedis) public readonly redis: Redis,
	) {}

	// TODO(DD): Figure out a better way to handle this schema-wise;
	// used to be an sql function used on insert but prisma doesn't play with those at all.
	// this is more than sub-optimal, esp. without caching, but won't be an issue short-term.
	public async getNextCaseId(guildId: string, prisma: TransactionPrisma = this.prisma): Promise<number> {
		return (
			((
				await prisma.case.findFirst({
					where: { guildId },
					orderBy: { caseId: 'desc' },
				})
			)?.caseId ?? 0) + 1
		);
	}

	public async makeWarnTriggerCase(cs: Case, prisma: TransactionPrisma = this.prisma): Promise<Case | null> {
		const userWarns = await prisma.case.findMany({
			where: {
				targetId: cs.targetId,
				guildId: cs.guildId,
				actionType: CaseAction.warn,
				pardonedBy: null,
			},
		});
		const warnPunishment = await prisma.warnPunishment.findFirst({
			where: {
				guildId: cs.guildId,
				warns: userWarns.length,
			},
		});
		const settings = await prisma.guildSettings.findFirst({ where: { guildId: cs.guildId } });

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
					(warnPunishment.actionType === WarnPunishmentAction.ban ||
						warnPunishment.actionType === WarnPunishmentAction.mute) &&
					warnPunishment.duration
						? new Date(Date.now() + Number(warnPunishment.duration))
						: undefined,
				reason: `automated punishment triggered for reaching ${userWarns.length} warnings`,
				unmuteRoles: settings?.useTimeoutsByDefault ?? true ? null : undefined,
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
				: (await prisma.unmuteRole.findMany({ where: { caseId: cs.id } })).map((role) => role.roleId),
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
				useTimeouts: 'unmuteRoles' in data ? data.unmuteRoles === null : false,
				unmuteRoles:
					(data.actionType === CaseAction.mute || data.actionType === CaseAction.unmute) && data.unmuteRoles
						? { createMany: { data: data.unmuteRoles.map((roleId) => ({ roleId })) } }
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

	private async handlePunishment(cs: Case, data: CaseData, prisma: TransactionPrisma = this.prisma) {
		switch (data.actionType) {
			case CaseAction.warn: {
				return;
			}

			case CaseAction.mute: {
				if (cs.useTimeouts) {
					const body: RESTPatchAPIGuildMemberJSONBody = { communication_disabled_until: cs.expiresAt?.toISOString() };

					return this.rest.patch(Routes.guildMember(cs.guildId, cs.targetId), { body });
				}

				const settings = await prisma.guildSettings.findFirst({
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

				await prisma.unmuteRole.createMany({
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

				const settings = await prisma.guildSettings.findFirst({ where: { guildId: cs.guildId } });
				const member = (await this.rest.get(Routes.guildMember(cs.guildId, cs.targetId))) as APIGuildMember;
				const baseRoles = member.roles.filter((role) => role !== settings?.muteRole);

				const unmuteRoles = await prisma.unmuteRole.findMany({ where: { caseId: cs.id } });
				const body: RESTPatchAPIGuildMemberJSONBody = {
					roles: baseRoles.concat(unmuteRoles.map((role) => role.roleId)),
				};
				return this.rest.patch(Routes.guildMember(cs.guildId, cs.targetId), { body });
			}

			case CaseAction.kick: {
				return this.rest.delete(Routes.guildMember(cs.guildId, cs.targetId));
			}

			case CaseAction.softban: {
				const body: RESTPutAPIGuildBanJSONBody = { delete_message_days: data.deleteDays ?? 1 };
				await this.rest.put(Routes.guildBan(cs.guildId, cs.targetId), { body });
				return this.rest.delete(Routes.guildBan(cs.guildId, cs.targetId));
			}

			case CaseAction.ban: {
				const body: RESTPutAPIGuildBanJSONBody = { delete_message_days: data.deleteDays };
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
		// eslint-disable-next-line no-extra-parens
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
		const guild = (await this.rest.get(Routes.guild(cs.guildId))) as APIGuild;
		await dmUser(
			cs.targetId,
			`You have been ${this.formatActionName(cs.actionType)} in ${guild.name}${
				cs.expiresAt ? ` for ${ms(cs.expiresAt.getTime() - Date.now(), true)}` : ''
			}.${cs.reason ? `\n\nReason: ${cs.reason}` : ''}`,
			cs.guildId,
		);
	}

	private async lock(cs: Case): Promise<void> {
		const key = `case_locks:${cs.actionType}:${cs.targetId}:${cs.guildId}`;
		const fiveMinutes = 300_000;
		await this.redis.set(key, cs.id, 'PX', fiveMinutes);
	}

	public async isLocked(actionType: CaseAction, targetId: string, guildId: string): Promise<Case | null> {
		const key = `case_locks:${actionType}:${targetId}:${guildId}`;
		const lockedCaseId = await this.redis.get(key);
		if (lockedCaseId) {
			return (
				this.prisma.case
					.findFirst({
						where: { id: Number.parseInt(lockedCaseId, 10) },
						rejectOnNotFound: true,
					})
					// eslint-disable-next-line promise/prefer-await-to-then
					.catch(() => null)
			);
		}

		return null;
	}

	public async create(data: CaseData): Promise<[cs: Case, warnTrigger?: Case]> {
		data.notifyUser ??= true;
		data.applyAction ??= true;

		const cases = await this.prisma.$transaction<[Case, Case?]>(
			async (prisma) => {
				const cs = await this.internalCreate(data, prisma);
				if (data.notifyUser) {
					await this.notifyUser(cs);
				}

				if (data.applyAction) {
					await this.handlePunishment(cs, data, prisma);
				}

				const coupleCases: [Case, Case?] = [cs];

				if (data.actionType === CaseAction.warn) {
					const triggeredCase = await this.makeWarnTriggerCase(cs, prisma);
					if (triggeredCase) {
						if (data.notifyUser) {
							await this.notifyUser(triggeredCase);
						}

						if (data.applyAction) {
							await this.handlePunishment(triggeredCase, await this.dataFromCase(triggeredCase), prisma);
						}

						coupleCases.push(triggeredCase);
					}
				}

				for (const caseItem of coupleCases) {
					await this.lock(caseItem!);
				}

				return coupleCases;
			},
			{ timeout: 120_000 },
		);

		this.logs.publish({
			type: LogTypes.modAction,
			data: cases as Case[],
		});

		return cases;
	}

	public async undoTimedAction(cs: Case, reason?: string): Promise<Case> {
		const unmuteRoles = await this.prisma.unmuteRole.findMany({ where: { caseId: cs.id } });

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
			reason: reason ?? 'automated timed action expiry',
			refId: cs.caseId,
			unmuteRoles: cs.useTimeouts ? null : unmuteRoles.map((role) => role.roleId),
		});

		try {
			await this.prisma.timedCaseTask.delete({
				where: { caseId: cs.id },
				include: { task: true },
			});
		} catch {}

		return undone;
	}
}
