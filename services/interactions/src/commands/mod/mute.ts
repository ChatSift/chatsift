import type { MuteCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { Rest } from '@chatsift/api-wrapper';
import { CaseManager, PermissionsChecker, UserPerms } from '@automoderator/util';
import { PubSubPublisher } from '@cordis/brokers';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import type { Command } from '../../command';
import type { Log } from '@automoderator/broker-types';
import ms from '@naval-base/ms';
import { CaseAction, PrismaClient } from '@prisma/client';
import { handleLockConfirmation } from './sub/handleLockConfirmation';

@injectable()
export default class implements Command {
	public constructor(
		public readonly rest: Rest,
		public readonly discord: DiscordRest,
		public readonly guildLogs: PubSubPublisher<Log>,
		public readonly checker: PermissionsChecker,
		public readonly cases: CaseManager,
		public readonly prisma: PrismaClient,
	) {}

	public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof MuteCommand>) {
		await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);
		const { user: member, reason, reference: refId, duration: durationString } = args;
		if (reason && reason.length >= 1900) {
			throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
		}

		if (member.user.id === interaction.member.user.id) {
			throw new ControlFlowError('You cannot mute yourself');
		}

		if (member.permissions && (await this.checker.check({ guild_id: interaction.guild_id, member }, UserPerms.mod))) {
			throw new ControlFlowError('You cannot action a member of the staff team');
		}

		let expiresAt: Date | undefined;
		const durationMinutes = Number(durationString);

		if (isNaN(durationMinutes)) {
			const duration = ms(durationString);
			if (!duration) {
				throw new ControlFlowError('Failed to parse the provided duration');
			}

			if (duration > ms('28d')) {
				throw new ControlFlowError('Mute duration cannot be longer than 28 days');
			}

			expiresAt = new Date(Date.now() + duration);
		} else {
			expiresAt = new Date(Date.now() + durationMinutes * 6e4);
		}

		const cs = await this.prisma.case.findFirst({
			where: {
				guildId: interaction.guild_id,
				targetId: member.user.id,
				actionType: CaseAction.mute,
				task: { isNot: null },
			},
		});

		if (cs) {
			throw new ControlFlowError('User is already muted');
		}

		const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
		const targetTag = `${member.user.username}#${member.user.discriminator}`;

		const locked = await this.cases.isLocked(CaseAction.mute, member.user.id, interaction.guild_id);
		if (locked && !(await handleLockConfirmation(interaction, member, locked))) {
			return;
		}

		const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: interaction.guild_id } });
		await this.cases.create({
			actionType: CaseAction.mute,
			guildId: interaction.guild_id,
			mod: {
				id: interaction.member.user.id,
				tag: modTag,
			},
			targetId: member.user.id,
			targetTag,
			reason,
			refId,
			expiresAt,
			unmuteRoles: settings?.useTimeoutsByDefault ?? true ? null : undefined,
		});

		await send(interaction, { content: `Successfully muted ${targetTag}`, components: [], embeds: [] });
	}
}
