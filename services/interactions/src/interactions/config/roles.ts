import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const RolesCommand = {
  name: 'roles',
  description: 'Manages self assignable roles',
  default_permission: false,
  perms: UserPerms.admin,
  options: [
    {
      name: 'prompt',
      description: 'Create a role selection prompt',
      type: ApplicationCommandOptionType.SubcommandGroup,
      options: [
        {
          name: 're-display',
          description: 'Re-posts an existing prompt',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'id',
              description: 'ID of the prompt you want to re-display',
              type: ApplicationCommandOptionType.Integer,
              required: true
            },
            {
              name: 'channel',
              description: 'Channel to display in - defaults to the current one',
              type: ApplicationCommandOptionType.Channel,
              required: false
            }
          ]
        },
        {
          name: 'delete',
          description: 'Deletes an existing prompt',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'id',
              description: 'ID of the prompt you want to delete',
              type: ApplicationCommandOptionType.Integer,
              required: true
            }
          ]
        },
        {
          name: 'create',
          description: 'Creates a new prompt for self assignable roles',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            {
              name: 'title',
              description: 'Embed title to use',
              type: ApplicationCommandOptionType.String,
              required: true
            },
            {
              name: 'description',
              description: 'Embed description to use',
              type: ApplicationCommandOptionType.String,
              required: false
            },
            {
              name: 'imageurl',
              description: 'Embed image to use',
              type: ApplicationCommandOptionType.String,
              required: false
            },
            {
              name: 'color',
              description: 'Embed color to use',
              type: ApplicationCommandOptionType.String,
              required: false
            },
            {
              name: 'channel',
              description: 'Channel to display in - defaults to the current one',
              type: ApplicationCommandOptionType.Channel,
              required: false
            },
            {
              name: 'usebuttons',
              description: 'As long as you have 3 or less roles, buttons will be used instead of a dropdown - defaults to false',
              type: ApplicationCommandOptionType.Boolean,
              required: false
            }
          ]
        }
      ]
    },
    {
      name: 'add',
      description: 'Adds a role to the list of self assignable roles',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'prompt',
          description: 'ID of the prompt you want to add this role to',
          type: ApplicationCommandOptionType.Integer,
          required: true
        },
        {
          name: 'role',
          description: 'The role to add',
          type: ApplicationCommandOptionType.Role,
          required: true
        },
        {
          name: 'emoji',
          description: 'Emoji to use (if any)',
          type: ApplicationCommandOptionType.String,
          required: false
        }
      ]
    },
    {
      name: 'remove',
      description: 'Removes a role from the list of self assignable roles',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        {
          name: 'prompt',
          description: 'ID of the prompt you want to add this role to',
          type: ApplicationCommandOptionType.Integer,
          required: true
        },
        {
          name: 'role',
          description: 'The role to remove',
          type: ApplicationCommandOptionType.Role,
          required: true
        }
      ]
    },
    {
      name: 'list',
      description: 'Lists all of the currently self assignable roles and their prompts',
      type: ApplicationCommandOptionType.Subcommand,
      options: []
    }
  ]
} as const;
