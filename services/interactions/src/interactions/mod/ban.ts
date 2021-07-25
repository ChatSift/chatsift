import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UserPerms } from '@automoderator/discord-permissions';

export const BanCommand = {
  name: 'ban',
  description: 'Bans a member',
  default_permission: false,
  perms: UserPerms.mod,
  options: [
    {
      name: 'user',
      description: 'The user to action',
      type: ApplicationCommandOptionType.User,
      required: true
    },
    {
      name: 'reason',
      description: 'The reason of this action',
      type: ApplicationCommandOptionType.String
    },
    {
      name: 'days',
      description: 'Number of days to delete messages for',
      type: ApplicationCommandOptionType.Integer,
      choices: [
        { name: '0 days', value: 0 },
        { name: '1 day', value: 1 },
        { name: '2 days', value: 2 },
        { name: '3 days', value: 3 },
        { name: '4 days', value: 4 },
        { name: '5 days', value: 5 },
        { name: '6 days', value: 6 },
        { name: '7 days', value: 7 }
      ]
    },
    {
      name: 'duration',
      description: 'Optional duration',
      type: ApplicationCommandOptionType.String
    },
    {
      name: 'reference',
      description: 'The reference case',
      type: ApplicationCommandOptionType.Integer
    }
  ]
} as const;
