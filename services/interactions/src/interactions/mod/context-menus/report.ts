import { ApplicationCommandType } from 'discord-api-types/v9';

export const ReportContextMenu = {
  name: 'Report',
  type: ApplicationCommandType.Message
} as const;
