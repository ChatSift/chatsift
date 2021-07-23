import { ApplicationCommandOptionType } from 'discord-api-types/v9';
import { UserPerms } from '../../util';

export const PardonCommand = {
  name: 'pardon',
  description: 'Pardons the given warn case',
  default_permission: false,
  perms: UserPerms.mod,
  options: [
    {
      name: 'case',
      description: 'The case to look pardon',
      type: ApplicationCommandOptionType.Integer,
      required: true
    }
  ]
} as const;
