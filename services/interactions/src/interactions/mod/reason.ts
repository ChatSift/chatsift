import { ApplicationCommandOptionType } from 'discord-api-types/v8';

export const ReasonCommand = {
  name: 'reason',
  description: 'Change the reason of a given mod action',
  options: [
    {
      name: 'case',
      description: 'The case to look up',
      type: ApplicationCommandOptionType.Integer,
      required: true
    },
    {
      name: 'reason',
      description: 'The updated reason',
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ]
} as const;
