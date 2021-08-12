import type { Interaction } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { basename, extname } from 'path';

export interface Command {
  name?: string;
  userPermissions?: UserPerms;
  exec(message: Interaction, args: unknown): unknown;
}

export interface CommandInfo {
  name: string;
}

export const commandInfo = (path: string): CommandInfo | null => {
  if (extname(path) !== '.js') {
    return null;
  }

  return {
    name: basename(path, '.js')
  };
};
