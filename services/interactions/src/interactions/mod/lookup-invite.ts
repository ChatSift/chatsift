import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const LookupInviteCommand = {
  name: 'lookup-invite',
  description: 'Looks up server information from a given invite',
  default_permission: false,
  perms: UserPerms.mod,
  options: [
    {
      name: 'invite',
      description: 'The invite to look up',
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ]
} as const;
