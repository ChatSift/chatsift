import { UserPerms } from '@automoderator/discord-permissions';
import { ApplicationCommandOptionType } from 'discord-api-types/v9';

export const ConfigNsfwDetectionCommand = {
  name: 'config-nsfw-detection',
  description: 'Configure NSFW detection thresholds',
  default_permission: false,
  perms: UserPerms.admin,
  options: [
    {
      name: 'hentai',
      description: 'Configure hentai threshold (number from 0 to 1, use decimal precision)',
      type: ApplicationCommandOptionType.Number,
      required: false
    },
    {
      name: 'porn',
      description: 'Configure porn threshold (number from 0 to 1, use decimal precision)',
      type: ApplicationCommandOptionType.Number,
      required: false
    },
    {
      name: 'sexy',
      description: 'Configure sexy threshold (number from 0 to 1, use decimal precision)',
      type: ApplicationCommandOptionType.Number,
      required: false
    }
  ]
} as const;
