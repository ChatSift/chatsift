import { ApplicationCommandOptionType } from 'discord-api-types';

export const BanurlCommand = {
  name: 'urls',
  description: 'Allows you to manage your server\'s url filters',
  default_permission: false,
  options: [
    {
      name: 'add',
      description: 'Adds an entry to the local url filters',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        {
          name: 'entries',
          description: 'The URLs to ban (please don\'t include the protocol at the start) - may use specific paths or domains',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'remove',
      description: 'Removes an entry from the local url filters',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        {
          name: 'entries',
          description: 'The URLs to remove from the list',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'list',
      description: 'Lists all the entries in your url filters',
      type: ApplicationCommandOptionType.SubCommand,
      options: []
    }
  ]
} as const;
