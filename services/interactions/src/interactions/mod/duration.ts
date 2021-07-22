import { ApplicationCommandOptionType } from 'discord-api-types/v8';

export const DurationCommand = {
  name: 'duration',
  description: 'Change the duration of a timed mod action',
  options: [
    {
      name: 'case',
      description: 'The case to look up',
      type: ApplicationCommandOptionType.Integer,
      required: true
    },
    {
      name: 'duration',
      description: 'The duration',
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ]
} as const;