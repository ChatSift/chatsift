import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const HistoryCommand = {
  name: 'history',
  description: 'Pulls up the history of a given user',
  default_permission: false,
  options: [
    {
      name: 'user',
      description: 'The user to look up',
      type: ApplicationCommandOptionType.User,
      required: true
    },
    {
      name: 'detailed',
      description: 'Lists all of the cases for the user',
      type: ApplicationCommandOptionType.Boolean
    }
  ]
} as const;
