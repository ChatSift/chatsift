import type { ConfigAutoCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { kLogger } from '@automoderator/injection';
import { Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import type { Command } from '../../command';
import { GuildSettings, PrismaClient } from '@prisma/client';

@injectable()
export default class implements Command {
	public constructor(
		public readonly discordRest: DiscordRest,
		public readonly prisma: PrismaClient,
		@inject(kLogger) public readonly logger: Logger,
	) {}

	private _sendCurrentSettings(interaction: APIGuildInteraction, settings: Partial<GuildSettings>) {
		return send(interaction, {
			content: stripIndents`
        **Here are your current settings:**
        • punishment cooldown: ${settings.automodCooldown ?? 'not set'}
        • text amount: ${settings.antispamAmount ?? 'not set'}
        • text time: ${settings.antispamTime ?? 'not set'}
        • mention limit: ${settings.mentionLimit ?? 'not set'}
        • mention amount: ${settings.mentionAmount ?? 'not set'}
        • mention time: ${settings.mentionTime ?? 'not set'}
      `,
			allowed_mentions: { parse: [] },
		});
	}

	public async exec(interaction: APIGuildInteraction, args: Partial<ArgumentsOf<typeof ConfigAutoCommand>>) {
		const { show, antispam, mention } = args;

		if (show) {
			const settings = await this.prisma.guildSettings.findFirst({ where: { guildId: interaction.guild_id } });
			return this._sendCurrentSettings(interaction, settings ?? {});
		}

		await send(interaction, {}, InteractionResponseType.DeferredChannelMessageWithSource);

		let settings: Partial<GuildSettings> = {};

		if (antispam?.amount) {
			if (antispam.amount < 2) {
				throw new ControlFlowError(
					'If you set this value to lower than 2, a punishment would trigger immediately, please use a value equal to or greater than 2.',
				);
			}

			if (antispam.amount > 20) {
				throw new ControlFlowError(
					'Tracking more than 20 messages seems redundant and causes heavy memory usage at scale, please use a lower value.' +
						"\n\nIf you have a use case for this, we'd love to hear it in the support server.",
				);
			}

			settings.antispamAmount = antispam.amount;
		}

		if (antispam?.time) {
			if (antispam.time < 2) {
				throw new ControlFlowError(
					'With a time lower than 2, a punishment would be nearly impossible to trigger, please use a value equal to or greater than 2.',
				);
			}

			if (antispam.time > 20) {
				throw new ControlFlowError(
					'Tracking messages for more than 20 seconds seems unreasonable and causes heavy memory usage at scale, please use a lower value.' +
						"\n\nIf you have a use case for this, we'd love to hear it in the support server.",
				);
			}

			settings.antispamTime = antispam.time;
		}

		if (mention?.amount) {
			if (mention.amount < 3) {
				throw new ControlFlowError(
					'With a value this low for mention amounts a punishment will be triggered way too easily on accident.',
				);
			}

			settings.mentionAmount = mention.amount;
		}

		if (mention?.limit) {
			if (mention.limit < 3) {
				throw new ControlFlowError(
					'With a value this low for mention amounts a punishment will be triggered way too easily on accident.',
				);
			}

			settings.mentionLimit = mention.limit;
		}

		if (mention?.time) {
			if (mention.time < 2) {
				throw new ControlFlowError(
					'With a time lower than 2, a punishment would be nearly impossible to trigger, please use a value equal to or greater than 2.',
				);
			}

			if (mention.time > 20) {
				throw new ControlFlowError(
					'Tracking messages for more than 20 seconds seems unreasonable and causes heavy memory usage at scale, please use a lower value.' +
						"\n\nIf you have a use case for this, we'd love to hear it in the support server.",
				);
			}

			settings.mentionTime = mention.time;
		}

		settings = Object.values(settings).length
			? await this.prisma.guildSettings.upsert({
					create: { ...settings, guildId: interaction.guild_id },
					update: settings,
					where: { guildId: interaction.guild_id },
			  })
			: (await this.prisma.guildSettings.findFirst({ where: { guildId: interaction.guild_id } })) ?? {};

		return this._sendCurrentSettings(interaction, settings);
	}
}
