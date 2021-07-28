import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const LogCommand = {
  name: 'log',
  description: 'Update your server\'s log channels',
  default_permission: false,
  options: [
    {
      name: 'mod',
      description: 'Moderation action logging',
      type: ApplicationCommandOptionType.Channel,
      required: false
    },
    {
      name: 'filters',
      description: 'Filter trigger logging',
      type: ApplicationCommandOptionType.Channel,
      required: false
    }
  ]
} as const;
