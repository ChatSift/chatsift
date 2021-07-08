import { ApplicationCommandOptionType } from 'discord-api-types/v8';

export const WarnCommand = {
  name: 'warn',
  description: 'Warns a member',
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
      name: 'reference',
      description: 'The reference case',
      type: ApplicationCommandOptionType.Integer
    }
  ]
} as const;
