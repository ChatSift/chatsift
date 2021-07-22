import { ApplicationCommandOptionType } from 'discord-api-types/v9';

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
    },
    {
      name: 'pardonwarnsafter',
      description: 'How many days to take before automatically pardoning warnings',
      type: ApplicationCommandOptionType.Integer,
      required: false
    }
  ]
} as const;
