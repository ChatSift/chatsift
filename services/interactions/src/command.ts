import { basename, extname } from 'path';
import type { Interaction, UserPerms } from '#util';

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
