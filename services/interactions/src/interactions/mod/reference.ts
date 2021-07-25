import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UserPerms } from '@automoderator/discord-permissions';

export const ReferenceCommand = {
  name: 'reference',
  description: 'Change the reference of a given mod action',
  default_permission: false,
  perms: UserPerms.mod,
  options: [
    {
      name: 'case',
      description: 'The case to look up',
      type: ApplicationCommandOptionType.Integer,
      required: true
    },
    {
      name: 'reference',
      description: 'The reference case',
      type: ApplicationCommandOptionType.Integer,
      required: true
    }
  ]
} as const;
