import { ApplicationCommandOptionType } from 'discord-api-types/v8';

export const ConfigCommand = {
  name: 'config',
  description: 'Update your server\'s config',
  options: [
    {
      name: 'modrole',
      description: 'Role used to identify people as moderators',
      type: ApplicationCommandOptionType.Role,
      required: false
    },
    {
      name: 'muterole',
      description: 'Role used to silence people when they are muted',
      type: ApplicationCommandOptionType.Role,
      required: false
    }
  ]
} as const;
