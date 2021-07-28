import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, ControlFlowError, send } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { LogCommand } from '#interactions';
import { HTTPError as CordisHTTPError, Rest } from '@cordis/rest';
import { kSql } from '@automoderator/injection';
import { stripIndents } from 'common-tags';
import {
  InteractionResponseType,
  Snowflake,
  APIGuildInteraction,
  ChannelType,
  RESTPostAPIChannelWebhookResult,
  RESTPostAPIChannelWebhookJSONBody,
  Routes
} from 'discord-api-types/v9';
import type { GuildSettings, WebhookToken } from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.admin;

  public constructor(
    public readonly rest: Rest,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  private _sendCurrentSettings(message: APIGuildInteraction, settings?: Partial<GuildSettings>) {
    const atChannel = (channel?: string | null) => channel ? `<#${channel}>` : 'none';

    return send(message, {
      content: stripIndents`
        **Here are your current settings:**
        • mod logs: ${atChannel(settings?.mod_action_log_channel)}
        • filter logs: ${atChannel(settings?.filter_trigger_log_channel)}
      `,
      allowed_mentions: { parse: [] }
    }, { update: true });
  }

  public parse(args: ArgumentsOf<typeof LogCommand>) {
    return {
      mod: args.mod,
      filters: args.filters
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof LogCommand>) {
    await send(interaction, {}, { type: InteractionResponseType.DeferredChannelMessageWithSource });
    const { mod, filters } = this.parse(args);

    let settings: Partial<GuildSettings> = { guild_id: interaction.guild_id };

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

    if (Object.values(settings).length === 1) {
      const [currentSettings] = await this.sql<[GuildSettings?]>`SELECT * FROM guild_settings WHERE guild_id = ${interaction.guild_id}`;
      return this._sendCurrentSettings(interaction, currentSettings);
    }

    [settings] = await this.sql<[GuildSettings]>`
      INSERT INTO guild_settings ${this.sql(settings)}
      ON CONFLICT (guild_id)
      DO
        UPDATE SET ${this.sql(settings)}
        RETURNING *
    `;

    const makeWebhook = async (channel: Snowflake, name: string) => {
      const webhook = await this.rest.post<RESTPostAPIChannelWebhookResult, RESTPostAPIChannelWebhookJSONBody>(
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
          await this.rest.get(Routes.webhook(data.webhook_id, data.webhook_token));
        } catch (error) {
          if (!(error instanceof CordisHTTPError) || error.response.status !== 404) {
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
          await this.rest.get(Routes.webhook(data.webhook_id, data.webhook_token));
        } catch (error) {
          if (!(error instanceof CordisHTTPError) || error.response.status !== 404) {
            throw error;
          }

          await makeWebhook(settings.filter_trigger_log_channel, 'Filter triggers');
        }
      } else {
        await makeWebhook(settings.filter_trigger_log_channel, 'Filter triggers');
      }
    }

    return this._sendCurrentSettings(interaction, settings);
  }
}
