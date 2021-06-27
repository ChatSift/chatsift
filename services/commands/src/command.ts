import { basename, extname } from 'path';
import type { APIGuildInteraction } from 'discord-api-types/v8';

export default interface Command {
  name?: string;
  exec(message: APIGuildInteraction, args: unknown): unknown;
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
