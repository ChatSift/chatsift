import type { Interaction } from '#util';
import { UserPerms } from '@automoderator/discord-permissions';
import { basename, extname } from 'path';

export interface Component {
  name?: string;
  userPermissions?: UserPerms;
  exec(message: Interaction, args: unknown[], key: string): unknown | Promise<unknown>;
}

export interface ComponentInfo {
  name: string;
}

export function componentInfo(path: string): ComponentInfo | null {
  if (extname(path) !== '.js') {
    return null;
  }

  return {
    name: basename(path, '.js')
  };
}
