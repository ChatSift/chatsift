import { NonWarnCase, WarnCase } from './brokers';
import { RouteBases, APIEmbed, APIUser, APIMessage, Snowflake } from 'discord-api-types/v9';
import { makeDiscordCdnUrl } from '@cordis/util';
import { Case, CaseAction } from './models';
import { addFields } from './embed';
import ms from './ms';

export const LOG_COLORS = Object.freeze({
  [CaseAction.warn]: 15309853,
  [CaseAction.mute]: 2895667,
  [CaseAction.unmute]: 5793266,
  [CaseAction.kick]: 15418782,
  [CaseAction.softban]: 15418782,
  [CaseAction.ban]: 15548997,
  [CaseAction.unban]: 5793266
} as const);

export const ACTIONS = Object.freeze({
  [CaseAction.warn]: 'warned',
  [CaseAction.mute]: 'muted',
  [CaseAction.unmute]: 'unmuted',
  [CaseAction.kick]: 'kicked',
  [CaseAction.softban]: 'softbanned',
  [CaseAction.ban]: 'banned',
  [CaseAction.unban]: 'unbanned'
} as const);

export interface CaseEmbedOptions {
  logChannelId?: Snowflake | null;
  cs: NonWarnCase | WarnCase | Case;
  target: APIUser;
  mod?: APIUser | null;
  pardonedBy?: APIUser | null;
  message?: APIMessage | null;
  refCs?: Case | null;
}

export const makeCaseEmbed = ({ logChannelId, cs, target, mod, pardonedBy, message, refCs: ref }: CaseEmbedOptions): APIEmbed => {
  let embed: APIEmbed = message?.embeds[0]
    ? message.embeds[0]
    : {
      title: `Was ${ACTIONS[cs.action_type]} for \`${cs.reason ?? 'Set a reason using /reason'}\``,
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

  if (pardonedBy) {
    embed = addFields(
      embed,
      {
        name: 'Pardoned by',
        value: `${pardonedBy.username}#${pardonedBy.discriminator}`
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

export interface HistoryEmbedOptions {
  user: APIUser;
  cases: Case[];
  showDetails: boolean;
  logChannelId?: Snowflake;
  filterTriggers?: number;
}

// The severity color system - bans = 3pt; kicks/softbans = 2pts; mutes = 0.5pts; warnings = 0.25pts;
//  >=3 points -> red
//  >=2 points -> orange
//  >0 points -> yellow
//  =0 points -> green

// TODO filter trigger counts
export const makeHistoryEmbed = ({ user, cases, showDetails, logChannelId, filterTriggers }: HistoryEmbedOptions): APIEmbed => {
  let points = 0;
  const counts = {
    [CaseAction.ban]: 0,
    [CaseAction.kick]: 0,
    [CaseAction.mute]: 0,
    [CaseAction.warn]: 0
  };

  const colors = [8450847, 13091073, 14917123, 15548997] as const;
  const details: string[] = [];

  for (const cs of cases) {
    if (cs.action_type === CaseAction.ban) {
      counts[CaseAction.ban]++;
      points += 3;
    } else if ([CaseAction.kick, CaseAction.softban].includes(cs.action_type)) {
      counts[CaseAction.kick]++;
      points += 2;
    } else if (cs.action_type === CaseAction.mute) {
      counts[CaseAction.mute]++;
      points += 0.5;
    } else if (cs.action_type === CaseAction.warn) {
      counts[CaseAction.warn]++;
      points += 0.25;
    } else {
      continue;
    }

    if (showDetails) {
      const timestamp = Math.round(cs.created_at.getTime() / 1000);
      const action = CaseAction[cs.action_type]!.toUpperCase();
      const caseId = cs.log_message_id && logChannelId
        ? `[#${cs.case_id}](https://discord.com/channels/${cs.guild_id}/${logChannelId}/${cs.log_message_id})`
        : `#${cs.case_id}`;

      details.push(`• <t:${timestamp}> \`${action}\` ${caseId} - \`${cs.reason ?? 'Set a reason using /reason'}\``);
    }
  }

  const embed: APIEmbed = {
    author: {
      name: `${user.username}#${user.discriminator} (${user.id})`,
      icon_url: user.avatar
        ? makeDiscordCdnUrl(`${RouteBases.cdn}/avatars/${user.id}/${user.avatar}`)
        : `${RouteBases.cdn}/embed/avatars/${parseInt(user.discriminator, 10) % 5}`
    },
    color: colors[Math.min(Math.floor(points), 3)]
  };

  const footer = Object
    .entries(counts)
    .reduce<string[]>((arr, [type, count]) => {
    if (count > 0) {
      arr.push(`${count} ${CaseAction[parseInt(type, 10)]}${count === 1 ? '' : 's'}`);
    }

    return arr;
  }, filterTriggers ? [`${filterTriggers} Filter triggers`] : [])
    .join(' | ');

  if (footer.length) {
    embed.footer = { text: footer };
  }

  if (showDetails) {
    embed.description = details.join('\n');
  }

  return embed;
};
