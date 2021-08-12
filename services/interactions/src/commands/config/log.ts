import { LogCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import type {
  ApiGetGuildsSettingsResult,
  ApiPatchGuildSettingsBody,
  ApiPatchGuildSettingsResult,
  GuildSettings,
  WebhookToken
} from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { Rest } from '@automoderator/http-client';
import { kSql } from '@automoderator/injection';
import { HTTPError as DiscordHTTPError, Rest as DiscordRest } from '@cordis/rest';
import { stripIndents } from 'common-tags';
import {
  APIGuildInteraction,
  ChannelType, InteractionResponseType,
  RESTPostAPIChannelWebhookJSONBody,
  RESTPostAPIChannelWebhookResult,
  Routes,
  Snowflake
} from 'discord-api-types/v9';
import type { Sql } from 'postgres';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private async _sendCurrentSettings(interaction: APIGuildInteraction) {
    const settings = await this.rest.get<ApiGetGuildsSettingsResult>(`/guilds/${interaction.guild_id}/settings`);
    const atChannel = (channel?: string | null) => channel ? `<#${channel}>` : 'none';

    return send(interaction, {
      content: stripIndents`
        **Here are your current settings:**
        • mod logs: ${atChannel(settings.mod_action_log_channel)}
        • filter logs: ${atChannel(settings.filter_trigger_log_channel)}
      `,
      allowed_mentions: { parse: [] }
    });
  }

  public parse(args: ArgumentsOf<typeof LogCommand>) {
    return {
      mod: args.mod,
      filters: args.filters
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof LogCommand>) {
    await send(interaction, {}, InteractionResponseType.DeferredChannelMessageWithSource);
    const { mod, filters } = this.parse(args);

    let settings: Partial<GuildSettings> = {};

    if (mod) {
      if (mod.type !== ChannelType.GuildText) {
        throw new ControlFlowError('Please provide a valid text channel');
      }

      settings.mod_action_log_channel = mod.id;
    }

    if (filters) {
      if (filters.type !== ChannelType.GuildText) {
        throw new ControlFlowError('Please provide a valid text channel');
      }

      settings.filter_trigger_log_channel = filters.id;
    }

    if (!Object.values(settings).length) {
      return this._sendCurrentSettings(interaction);
    }

    settings = await this.rest.patch<ApiPatchGuildSettingsResult, ApiPatchGuildSettingsBody>(
      `/guilds/${interaction.guild_id}/settings`,
      settings
    );

    const makeWebhook = async (channel: Snowflake, name: string) => {
      const webhook = await this.discordRest.post<RESTPostAPIChannelWebhookResult, RESTPostAPIChannelWebhookJSONBody>(
        Routes.channelWebhooks(channel), {
          data: {
            name
          }
        }
      ).catch(() => null);

      if (webhook) {
        const data: WebhookToken = {
          channel_id: channel,
          webhook_id: webhook.id,
          webhook_token: webhook.token!
        };

        await this.sql`
          INSERT INTO webhook_tokens ${this.sql(data)}
          ON CONFLICT (channel_id)
          DO UPDATE SET ${this.sql(data)}
        `;
      }
    };

    if (settings.mod_action_log_channel) {
      const [data] = await this.sql<[WebhookToken?]>`SELECT * FROM webhook_tokens WHERE channel_id = ${settings.mod_action_log_channel}`;
      if (data) {
        try {
          await this.discordRest.get(Routes.webhook(data.webhook_id, data.webhook_token));
        } catch (error) {
          if (!(error instanceof DiscordHTTPError) || error.response.status !== 404) {
            throw error;
          }

          await makeWebhook(settings.mod_action_log_channel, 'Mod Actions');
        }
      } else {
        await makeWebhook(settings.mod_action_log_channel, 'Mod Actions');
      }
    }

    if (settings.filter_trigger_log_channel) {
      const [data] = await this.sql<[WebhookToken?]>`SELECT * FROM webhook_tokens WHERE channel_id = ${settings.filter_trigger_log_channel}`;

      if (data) {
        try {
          await this.discordRest.get(Routes.webhook(data.webhook_id, data.webhook_token));
        } catch (error) {
          if (!(error instanceof DiscordHTTPError) || error.response.status !== 404) {
            throw error;
          }

          await makeWebhook(settings.filter_trigger_log_channel, 'Filter triggers');
        }
      } else {
        await makeWebhook(settings.filter_trigger_log_channel, 'Filter triggers');
      }
    }

    return this._sendCurrentSettings(interaction);
  }
}
