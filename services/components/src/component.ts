import { basename, extname } from 'path';
import type { UserPerms } from '@automoderator/interaction-util';

export interface Component {
  name?: string;
  userPermissions?: UserPerms;
  exec(message: any, args: unknown): unknown | Promise<unknown>;
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
