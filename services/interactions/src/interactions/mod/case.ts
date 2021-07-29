import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UserPerms } from '@automoderator/discord-permissions';

const csOption = {
  name: 'case',
  description: 'The case to act on',
  type: ApplicationCommandOptionType.Integer,
  required: true
} as const;

export const CaseCommand = {
  name: 'case',
  description: 'Run actions on a given case',
  default_permission: false,
  perms: UserPerms.mod,
  options: [
    {
      name: 'show',
      description: 'Brings up a case',
      type: ApplicationCommandOptionType.SubCommand,
      options: [csOption]
    },
    {
      name: 'delete',
      description: 'Deletes a case',
      type: ApplicationCommandOptionType.SubCommand,
      options: [csOption]
    },
    {
      name: 'reason',
      description: 'Change the reason of a given mod action',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        csOption,
        {
          name: 'reason',
          description: 'The updated reason',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'duration',
      description: 'Change the duration of a given mod action',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        csOption,
        {
          name: 'duration',
          description: 'The updated duration',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'reference',
      description: 'Change the reference of a given mod action',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        csOption,
        {
          name: 'reference',
          description: 'The updated reference case',
          type: ApplicationCommandOptionType.Integer,
          required: true
        }
      ]
    }
  ]
} as const;
