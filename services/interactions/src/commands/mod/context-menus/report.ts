import { ReportContextMenu } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import type { ApiGetGuildsSettingsResult } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { getCreationData, makeDiscordCdnUrl } from '@cordis/util';
import {
  RESTPostAPIChannelMessageResult,
  RESTPostAPIChannelMessageJSONBody,
  APIGuildInteraction,
  ComponentType,
  ButtonStyle,
  Routes,
  RouteBases
} from 'discord-api-types/v9';
import { injectable } from 'tsyringe';
import { Command } from '../../../command';
import { nanoid } from 'nanoid';

@injectable()
export default class implements Command {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest
  ) {}

  public async exec(interaction: APIGuildInteraction, { message }: ArgumentsOf<typeof ReportContextMenu>) {
    const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);

    if (!settings.reports_channel) {
      throw new ControlFlowError('This server does not have a reports channel set up.');
    }

    const id = nanoid();

    await this.discordRest.post<RESTPostAPIChannelMessageResult, RESTPostAPIChannelMessageJSONBody>(
      Routes.channelMessages(settings.reports_channel), {
        data: {
          embeds: [
            {
              color: 15953004,
              author: {
                name: `${message.author.username}#${message.author.discriminator} (${message.author.id})`,
                icon_url: message.author.avatar
                  ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${message.author.id}/${message.author.avatar}`)
                  : `${RouteBases.cdn}/embed/avatars/${parseInt(message.author.discriminator, 10) % 5}.png`
              },
              title: `Had their message posted <t:${Math.round(getCreationData(message.id).createdTimestamp / 1000)}:R> reported`,
              description: `\`\`\`${message.content}\`\`\``,
              footer: {
                text: `Reported by: ${interaction.member.user.username}#${interaction.member.user.discriminator} (${interaction.member.user.id})`,
                icon_url: interaction.member.user.avatar
                  ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}`)
                  : `${RouteBases.cdn}/embed/avatars/${parseInt(interaction.member.user.discriminator, 10) % 5}.png`
              }
            }
          ],
          components: [
            {
              type: ComponentType.ActionRow,
              components: [
                {
                  type: ComponentType.Button,
                  label: 'Review',
                  style: ButtonStyle.Link,
                  url: `https://discord.com/channels/${interaction.guild_id}/${message.channel_id}/${message.id}`
                },
                {
                  type: ComponentType.Button,
                  label: 'Actioned',
                  style: ButtonStyle.Secondary,
                  custom_id: `report|${id}|action`
                },
                {
                  type: ComponentType.Button,
                  label: 'Acknowledged',
                  style: ButtonStyle.Secondary,
                  custom_id: `report|${id}|acknowledge`
                }
              ]
            }
          ]
        }
      }
    );

    return send(interaction, {
      content: 'Successfully flagged the given message to the staff team',
      flags: 64
    });
  }
}
