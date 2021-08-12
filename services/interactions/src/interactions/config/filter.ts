import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const FilterCommand = {
  name: 'filter',
  description: 'Allows you to interact with the config, add, remove or even list entries in any given filter',
  default_permission: false,
  perms: UserPerms.admin,
  options: [
    {
      name: 'config',
      description: 'Allows you to interact with the server\'s filter config',
      type: ApplicationCommandOptionType.SubcommandGroup,
      options: [
        {
          name: 'show',
          description: 'Shows the current config',
          type: ApplicationCommandOptionType.Subcommand,
          options: []
        },
        {
          name: 'edit',
          description: 'Edits the current config',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'urls',
              description: 'If the url filter should be used',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            },
            {
              name: 'files',
              description: 'If the files filter should be used',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            },
            {
              name: 'invites',
              description: 'If the invites filter should be used',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            }
          ]
        },
        {
          name: 'ignore',
          description: 'Allows you to configure the ignores for a given channel',
          type: ApplicationCommandOptionType.Subcommand,
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
          type: ApplicationCommandOptionType.Subcommand,
          options: []
        }
      ]
    },
    {
      name: 'invites',
      description: 'Allows you to manage your local invite filters',
      type: ApplicationCommandOptionType.SubcommandGroup,
      options: [
        {
          name: 'allow',
          description: 'Adds the given invites to the allow list',
          type: ApplicationCommandOptionType.Subcommand,
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
          type: ApplicationCommandOptionType.Subcommand,
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
          type: ApplicationCommandOptionType.Subcommand,
          options: []
        }
      ]
    }
  ]
} as const;
