import { ReportContextMenu } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import type { ApiGetGuildsSettingsResult } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { APIGuildInteraction, InteractionResponseType } from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Command } from '../../../command';
import { ReportFailure, reportMessage } from '@automoderator/util';

@injectable()
export default class implements Command {
  public constructor(
    public readonly rest: Rest
  ) {}

  public async exec(interaction: APIGuildInteraction, { message }: ArgumentsOf<typeof ReportContextMenu>) {
    await send(interaction, { flags: 64 }, InteractionResponseType.DeferredChannelMessageWithSource);
    const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

    if (!settings.reports_channel) {
      throw new ControlFlowError('This server does not have a reports channel set up.');
    }

    if (message.author.id === interaction.member.user.id) {
      throw new ControlFlowError('You cannot report your own message.');
    }

    try {
      await reportMessage(interaction.guild_id, interaction.member.user, message, settings);
      return send(interaction, {
        content: 'Successfully flagged the given message to the staff team',
        flags: 64
      });
    } catch (error) {
      if (error instanceof ReportFailure) {
        throw new ControlFlowError(error.reason);
      }

      throw error;
    }
  }
}
