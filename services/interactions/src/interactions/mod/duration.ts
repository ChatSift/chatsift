import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UserPerms } from '@automoderator/discord-permissions';

export const DurationCommand = {
  name: 'duration',
  description: 'Change the duration of a timed mod action',
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
      name: 'duration',
      description: 'The duration',
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ]
} as const;
