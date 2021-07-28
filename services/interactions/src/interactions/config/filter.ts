import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UseFilterMode } from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';

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
            {
              name: 'urls',
              description: 'How the url filter should be used',
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
              description: 'How the files filter should be used',
              type: ApplicationCommandOptionType.Integer,
              choices: [
                { name: 'Disable', value: UseFilterMode.none },
                { name: 'Only local filters', value: UseFilterMode.guildOnly },
                { name: 'Local and global filters', value: UseFilterMode.all }
              ],
              required: false
            },
            {
              name: 'invites',
              description: 'How the invites filter should be used',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            }
          ]
        },
        {
          name: 'ignore',
          description: 'Allows you to configure the ignores for a given channel',
          type: ApplicationCommandOptionType.SubCommand,
          options: [
            {
              name: 'channel',
              description: 'The channel to update',
              type: ApplicationCommandOptionType.Channel,
              required: true
            },
            {
              name: 'urls',
              description: 'If the URL filter should be disabled in the given channel',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            },
            {
              name: 'files',
              description: 'If the files filter should be disabled in the given channel',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            },
            {
              name: 'invites',
              description: 'If the invites filter should be disabled in the given channel',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            },
            {
              name: 'words',
              description: 'If the words (/banword) filter should be disabled in the given channel',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            }
          ]
        },
        {
          name: 'ignorelist',
          description: 'Shows all the currently ignored channels',
          type: ApplicationCommandOptionType.SubCommand,
          options: []
        }
      ]
    },
    {
      name: 'urls',
      description: 'Allows you to manage url filters',
      type: ApplicationCommandOptionType.SubCommandGroup,
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
    },
    {
      name: 'files',
      description: 'Allows you to manage file filters',
      type: ApplicationCommandOptionType.SubCommandGroup,
      options: [
        {
          name: 'add',
          description: 'Adds an entry to the local file filters',
          type: ApplicationCommandOptionType.SubCommand,
          options: [
            {
              name: 'hashes',
              description: 'Hashes of the files you wish to ban',
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
              name: 'hashes',
              description: 'The hashes to remove',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'list',
          description: 'Lists all the entries in your file filters',
          type: ApplicationCommandOptionType.SubCommand,
          options: []
        }
      ]
    },
    {
      name: 'invites',
      description: 'Allows you to manage your local invite filters',
      type: ApplicationCommandOptionType.SubCommandGroup,
      options: [
        {
          name: 'allow',
          description: 'Adds the given invites to the allow list',
          type: ApplicationCommandOptionType.SubCommand,
          options: [
            {
              name: 'entries',
              description: 'The entries to allow',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'unallow',
          description: 'Removes the given invites from the allow list',
          type: ApplicationCommandOptionType.SubCommand,
          options: [
            {
              name: 'entries',
              description: 'The entries to remove from the allowlist',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        },
        {
          name: 'list',
          description: 'Lists all the allowed invites',
          type: ApplicationCommandOptionType.SubCommand,
          options: []
        }
      ]
    }
  ]
} as const;
