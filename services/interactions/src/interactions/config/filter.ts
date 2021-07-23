import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UseFilterMode } from '@automoderator/core';
import { UserPerms } from '../../util';

const typeOption = {
  name: 'filter',
  description: 'The filter to target',
  type: ApplicationCommandOptionType.String,
  choices: [
    { name: 'urls', value: 'urls' },
    { name: 'files', value: 'files' }
  ],
  required: true
} as const;

export const FilterCommand = {
  name: 'filter',
  description: 'Allows you to interact with the config, add, remove or even list entries in any given filter',
  default_permission: false,
  perms: UserPerms.admin,
  options: [
    {
      name: 'config',
      description: 'Allows you to interact with the server\'s filter config',
      type: ApplicationCommandOptionType.SubCommandGroup,
      options: [
        {
          name: 'show',
          description: 'Shows the current config',
          type: ApplicationCommandOptionType.SubCommand,
          options: []
        },
        {
          name: 'edit',
          description: 'Edits the current config',
          type: ApplicationCommandOptionType.SubCommand,
          options: [
            typeOption,
            {
              name: 'mode',
              description: 'How the given filter should be used',
              type: ApplicationCommandOptionType.Integer,
              choices: [
                { name: 'Disable', value: UseFilterMode.none },
                { name: 'Only local filters', value: UseFilterMode.guildOnly },
                { name: 'Local and global filters', value: UseFilterMode.all }
              ],
              required: true
            }
          ]
        }
      ]
    },
    {
      name: 'add',
      description: 'Adds an entry to the given filter',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        typeOption,
        {
          name: 'entry',
          description: 'The entry to add',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'remove',
      description: 'Removes an entry from the given filter',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        typeOption,
        {
          name: 'entry',
          description: 'The entry to remove',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    }
  ]
} as const;
