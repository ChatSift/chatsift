import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const RaidCleanupCommand = {
  name: 'raid-cleanup',
  description: 'Cleans up a recent raid by using an account age-join age relationship',
  default_permission: false,
  perms: UserPerms.mod,
  options: [
    {
      name: 'join',
      description: 'How long should a member have been in the server for the cleanup to ignore them',
      type: ApplicationCommandOptionType.String,
      required: false
    },
    {
      name: 'age',
      description: 'How old should a member\'s account be for the cleanup to ignore them',
      type: ApplicationCommandOptionType.String,
      required: false
    }
  ]
} as const;
