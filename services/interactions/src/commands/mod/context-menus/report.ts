import { ReportContextMenu } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import type { ApiGetGuildsSettingsResult, MessageReporter, ReportedMessage } from '@automoderator/core';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { getCreationData, makeDiscordCdnUrl } from '@cordis/util';
import {
  RESTPostAPIChannelMessageResult,
  RESTPostAPIChannelMessageJSONBody,
  RESTPatchAPIChannelMessageJSONBody,
  APIGuildInteraction,
  APIMessage,
  InteractionResponseType,
  ComponentType,
  ButtonStyle,
  Routes,
  RouteBases
} from 'discord-api-types/v9';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../../command';
import { nanoid } from 'nanoid';
import { kSql } from '@automoderator/injection';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    @inject(kSql) public readonly sql: Sql<{}>
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

    return this.sql.begin(async sql => {
      const [existingReport] = await sql<[ReportedMessage?]>`SELECT * FROM reported_messages WHERE message_id = ${message.id}`;

      if (existingReport) {
        if (existingReport.ack) {
          throw new ControlFlowError('This message has been reported previously and has since been acknowledged by the staff team.');
        }

        const reporters = await sql<MessageReporter[]>`SELECT * FROM message_reporters WHERE message_id = ${message.id}`;
        if (reporters.find(reporter => reporter.reporter_id === interaction.member.user.id)) {
          throw new ControlFlowError('You have already reported this message.');
        }

        const originalReport = reporters.find(reporter => reporter.original)!;
        const originalMessage = await this.discordRest.get<APIMessage>(
          Routes.channelMessage(settings.reports_channel!, existingReport.report_message_id)
        );
        const embed = originalMessage.embeds[0]!;

        await this.discordRest.patch<unknown, RESTPatchAPIChannelMessageJSONBody>(
          Routes.channelMessage(settings.reports_channel!, existingReport.report_message_id), {
            data: {
              embeds: [
                {
                  ...embed,
                  footer: {
                    text: `Reported by: ${originalReport.reporter_tag} (${originalReport.reporter_id}) and ${reporters.length} others`,
                    icon_url: embed.footer!.icon_url
                  }
                }
              ]
            }
          }
        );

        await sql`
          INSERT INTO message_reporters (message_id, reporter_id, reporter_tag)
          VALUES (
            ${message.id},
            ${interaction.member.user.id},
            ${`${interaction.member.user.username}#${interaction.member.user.discriminator}`}
          )
        `;
      } else {
        const id = nanoid();

        const reportMessage = await this.discordRest.post<RESTPostAPIChannelMessageResult, RESTPostAPIChannelMessageJSONBody>(
          Routes.channelMessages(settings.reports_channel!), {
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
                      custom_id: `report|${id}|${message.id}|action`
                    },
                    {
                      type: ComponentType.Button,
                      label: 'Acknowledged',
                      style: ButtonStyle.Secondary,
                      custom_id: `report|${id}|${message.id}|acknowledge`
                    }
                  ]
                }
              ]
            }
          }
        );

        await sql`
          INSERT INTO reported_messages (message_id, report_message_id)
          VALUES (${message.id}, ${reportMessage.id})
        `;

        await sql`
          INSERT INTO message_reporters (message_id, original, reporter_id, reporter_tag)
          VALUES (
            ${message.id},
            true,
            ${interaction.member.user.id},
            ${`${interaction.member.user.username}#${interaction.member.user.discriminator}`}
          )
        `;
      }

      await send(interaction, {
        content: 'Successfully flagged the given message to the staff team',
        flags: 64
      });
    });
  }
}
