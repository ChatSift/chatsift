import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const ConfigAutomodIgnoresCommand = {
  name: 'banword',
  description: 'Configure automoderation exclusions',
  default_permission: false,
  perms: UserPerms.admin,
  options: [
    {
      name: 'update',
      description: 'Configure automoderation exclusions',
      type: ApplicationCommandOptionType.Subcommand,
      options: []
    },
    {
      name: 'show',
      description: 'Shows all of the currently ignored channels',
      type: ApplicationCommandOptionType.Subcommand,
      options: []
    }
  ]
} as const;
