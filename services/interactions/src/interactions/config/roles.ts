import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const RolesCommand = {
  name: 'roles',
  description: 'Manages self assignable roles',
  options: [
    {
      name: 'prompt',
      description: 'Create a role selection prompt',
      type: ApplicationCommandOptionType.SubCommandGroup,
      options: [
        {
          name: 'display',
          description: 'Displays the current prompt for self assignable roles',
          type: ApplicationCommandOptionType.SubCommand,
          options: []
        },
        {
          name: 'set',
          description: 'Updates the prompt for self assignable roles',
          type: ApplicationCommandOptionType.SubCommand,
          options: [
            {
              name: 'prompt',
              description: 'The prompt to use',
              type: ApplicationCommandOptionType.String,
              required: true
            }
          ]
        }
      ]
    },
    {
      name: 'add',
      description: 'Adds a role to the list of self assignable roles',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
        {
          name: 'role',
          description: 'The role to add',
          type: ApplicationCommandOptionType.Role,
          required: true
        }
      ]
    },
    {
      name: 'remove',
      description: 'Removes a role from the list of self assignable roles',
      type: ApplicationCommandOptionType.SubCommand,
      options: [
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
      description: 'Lists all of the currently self assignable roles',
      type: ApplicationCommandOptionType.SubCommand,
      options: []
    }
  ]
} as const;
