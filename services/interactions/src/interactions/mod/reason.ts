import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UserPerms } from '@automoderator/discord-permissions';

export const ReasonCommand = {
  name: 'reason',
  description: 'Change the reason of a given mod action',
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
      name: 'reason',
      description: 'The updated reason',
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ]
} as const;
