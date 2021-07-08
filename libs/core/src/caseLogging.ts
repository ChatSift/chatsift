import { NonStrikeCase, StrikeCase } from './brokers';
import { RouteBases, APIEmbed, APIUser, APIMessage, Snowflake } from 'discord-api-types/v8';
import { makeDiscordCdnUrl } from '@cordis/util';
import { Case, CaseAction } from './models';
import { addFields } from './embed';
import ms from './ms';

export const LOG_COLORS = Object.freeze({
  [CaseAction.warn]: 15309853,
  [CaseAction.strike]: 15309853,
  [CaseAction.mute]: 2895667,
  [CaseAction.unmute]: 5793266,
  [CaseAction.kick]: 15418782,
  [CaseAction.softban]: 15418782,
  [CaseAction.ban]: 15548997,
  [CaseAction.unban]: 5793266
} as const);

export const ACTIONS = Object.freeze({
  [CaseAction.warn]: 'warned',
  [CaseAction.strike]: 'striked',
  [CaseAction.mute]: 'muted',
  [CaseAction.unmute]: 'unmuted',
  [CaseAction.kick]: 'kicked',
  [CaseAction.softban]: 'softbanned',
  [CaseAction.ban]: 'banned',
  [CaseAction.unban]: 'unbanned'
} as const);

export interface CaseEmbedOptions {
  logChannelId?: Snowflake | null;
  cs: NonStrikeCase | StrikeCase | Case;
  target: APIUser;
  mod?: APIUser | null;
  message?: APIMessage | null;
  refCs?: Case | null;
}

export const makeCaseEmbed = ({ logChannelId, cs, target, mod, message, refCs: ref }: CaseEmbedOptions): APIEmbed => {
  let embed: APIEmbed = message?.embeds[0]
    ? message.embeds[0]
    : {
      title: `Was ${ACTIONS[cs.action_type]}${cs.reason ? ` for ${cs.reason}` : ''}`,
      color: LOG_COLORS[cs.action_type],
      author: {
        name: `${cs.target_tag} (${cs.target_id})`,
        icon_url: target.avatar
          ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${target.id}/${target.avatar}`)
          : `${RouteBases.cdn}/embed/avatars/${parseInt(target.discriminator, 10) % 5}`
      }
    };

  // Set seperately so text field is processed even on case updates in case mod data was missed for whatever reason
  embed.footer = {
    text: `Case ${cs.case_id}${cs.mod_tag ? ` | By ${cs.mod_tag} (${cs.mod_id!})` : ''}`,
    icon_url: mod
      ? (
        mod.avatar
          ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${mod.id}/${mod.avatar}`)
          : `${RouteBases.cdn}/embed/avatars/${parseInt(mod.discriminator, 10) % 5}`
      )
      : undefined
  };

  if (cs.ref_id && ref && !embed.fields?.length) {
    embed = addFields(
      embed,
      {
        name: 'Reference',
        value: ref.log_message_id && logChannelId
          ? `[#${ref.case_id}](https://discord.com/channels/${cs.guild_id}/${logChannelId}/${ref.log_message_id})`
          : `#${ref.case_id}`
      }
    );
  }

  if (cs.expires_at) {
    embed = addFields(
      embed,
      {
        name: 'Duration',
        value: ms(new Date(cs.expires_at).getTime() - new Date(cs.created_at).getTime(), true)
      }
    );
  }

  return embed;
};
