import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UserPerms } from '@automoderator/discord-permissions';

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
      options: [
        {
          name: 'case',
          description: 'The case to look up',
          type: ApplicationCommandOptionType.Integer,
          required: true
        }
      ]
    },
    {
      name: 'delete',
      description: 'Deletes a case',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        {
          name: 'case',
          description: 'The case to delete',
          type: ApplicationCommandOptionType.Integer,
          required: true
        }
      ]
    }
  ]
} as const;
