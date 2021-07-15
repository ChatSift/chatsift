import { ApplicationCommandOptionType } from 'discord-api-types/v8';
import { UseFilterMode } from '@automoderator/core';

export const FilterCommand = {
  name: 'filter',
  description: 'Update your server\'s filter config',
  options: [
    {
      name: 'urls',
      description: 'Defines how (and if) the bot should run url filters',
      type: ApplicationCommandOptionType.Integer,
      choices: [
        { name: 'Disable', value: UseFilterMode.none },
        { name: 'Only local filters', value: UseFilterMode.guildOnly },
        { name: 'Local and global filters', value: UseFilterMode.all }
      ],
      required: false
    },
    {
      name: 'files',
      description: 'Defines how (and if) the bot should run file filters',
      type: ApplicationCommandOptionType.Integer,
      choices: [
        { name: 'Disable', value: UseFilterMode.none },
        { name: 'Only local filters', value: UseFilterMode.guildOnly },
        { name: 'Local and global filters', value: UseFilterMode.all }
      ],
      required: false
    }
  ]
} as const;
