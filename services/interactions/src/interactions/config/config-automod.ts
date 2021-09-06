import { AutomodPunishmentAction } from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const ConfigAutoCommand = {
  name: 'config-automod',
  description: 'Configure automod settings',
  default_permission: false,
  perms: UserPerms.admin,
  options: [
    {
      name: 'show',
      description: 'Shows the current options',
      type: ApplicationCommandOptionType.Subcommand,
      options: []
    },
    {
      name: 'antispam',
      description: 'Configure antispam options',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'amount',
          description: 'Configure how many messages should trigger a punishment',
          type: ApplicationCommandOptionType.Integer,
          required: false
        },
        {
          name: 'time',
          description: 'Configure in what interval (seconds) those messages need to be sent for a mute to trigger',
          type: ApplicationCommandOptionType.Integer,
          required: false
        }
      ]
    },
    {
      name: 'mention',
      description: 'Configure settings regarding mentions',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'limit',
          description: 'Max number of mentions per message',
          type: ApplicationCommandOptionType.Integer,
          required: false
        },
        {
          name: 'amount',
          description: 'How many mentions a user is allowed before triggering a punishment',
          type: ApplicationCommandOptionType.Integer,
          required: false
        },
        {
          name: 'time',
          description: 'In what interval the configured amount of mentions needs to be sent for a punishment to trigger',
          type: ApplicationCommandOptionType.Integer,
          required: false
        }
      ]
    },
    {
      name: 'punishments',
      description: 'Configure automod punishments',
      type: ApplicationCommandOptionType.SubcommandGroup,
      options: [
        {
          name: 'set-cooldown',
          description: 'Set how many minutes to wait before de-escalating the punishment a user will receive',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'cooldown',
              description: 'The value to use',
              type: ApplicationCommandOptionType.Integer,
              required: true
            }
          ]
        },
        {
          name: 'add',
          description: 'Add a new punishment',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'count',
              description: 'How many automod triggers are needed to trigger this punishment',
              type: ApplicationCommandOptionType.Integer,
              required: true
            },
            {
              name: 'punishment',
              description: 'The punishment to apply',
              type: ApplicationCommandOptionType.Integer,
              required: true,
              choices: [
                { name: 'warn', value: AutomodPunishmentAction.warn },
                { name: 'mute', value: AutomodPunishmentAction.mute },
                { name: 'ban', value: AutomodPunishmentAction.ban },
                { name: 'kick', value: AutomodPunishmentAction.kick }
              ]
            },
            {
              name: 'duration',
              description: 'Duration of the action (in minutes)',
              type: ApplicationCommandOptionType.Integer,
              required: false
            }
          ]
        },
        {
          name: 'delete',
          description: 'Deletes a punishment',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'count',
              description: 'How many automod triggers were needed to trigger this punishment',
              type: ApplicationCommandOptionType.Integer,
              required: true
            }
          ]
        },
        {
          name: 'list',
          description: 'Lists all the existing punishments',
          type: ApplicationCommandOptionType.Subcommand,
          options: []
        }
      ]
    }
  ]
} as const;
