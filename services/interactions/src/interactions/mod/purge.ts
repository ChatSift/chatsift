import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const PurgeCommand = {
  name: 'purge',
  description: 'Purges messages based off of your given arguments',
  default_permission: false,
  perms: UserPerms.mod,
  options: [
    {
      name: 'amount',
      description: 'The (max) amount of messages to delete - capped at 500',
      type: ApplicationCommandOptionType.Integer
    },
    {
      name: 'channel',
      description: 'Channel to delete messages from - defaults to the current channel',
      type: ApplicationCommandOptionType.Channel
    },
    {
      name: 'user',
      description: 'Deletes messages only from the given user',
      type: ApplicationCommandOptionType.User
    },
    {
      name: 'start',
      description: 'This is the "starting" point for range based purging - end is required if you use this option',
      type: ApplicationCommandOptionType.String
    },
    {
      name: 'end',
      description: 'This is the "ending" point for range based puring - start is required if you use this option',
      type: ApplicationCommandOptionType.String
    },
    {
      name: 'bots',
      description: 'If you wish to only delete messages posted by bots',
      type: ApplicationCommandOptionType.Boolean
    },
    {
      name: 'includes',
      description: 'Only delete messages that include the given text',
      type: ApplicationCommandOptionType.String
    }
  ]
} as const;
