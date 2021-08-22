import type {
  APIGuildMember,
  APIPartialChannel,
  APIRole,
  APIUser,
  APIMessage,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  Permissions
} from 'discord-api-types/v9';

type Command = Readonly<{
  name: string;
  description?: string;
  type?: ApplicationCommandType;
  options?: readonly Option[];
}>;

type Option = Readonly<Pick<Command, 'name' | 'description'> & (
  | {
    type: ApplicationCommandOptionType.Subcommand | ApplicationCommandOptionType.SubcommandGroup;
    options?: readonly Option[];
  }
  | {
    type: ApplicationCommandOptionType.String;
    choices?: readonly Readonly<{ name: string; value: string }>[];
  }
  | {
    type: ApplicationCommandOptionType.Integer;
    choices?: readonly Readonly<{ name: string; value: number }>[];
  }
  | {
    type:
    | ApplicationCommandOptionType.Boolean
    | ApplicationCommandOptionType.User
    | ApplicationCommandOptionType.Channel
    | ApplicationCommandOptionType.Role;
  }
)>;

type Simplify<T> = T extends unknown ? { [K in keyof T]: Simplify<T[K]> } : T;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type TypeIdToType<T, O, C> = T extends ApplicationCommandOptionType.Subcommand
  ? ArgumentsOfRaw<O>

  : T extends ApplicationCommandOptionType.SubcommandGroup
    ? ArgumentsOfRaw<O>

    : T extends ApplicationCommandOptionType.String
      ? C extends readonly { value: string }[]
        ? C[number]['value']
        : string

      : T extends ApplicationCommandOptionType.Integer
        ? C extends readonly { value: number }[]
          ? C[number]['value']
          : number

        : T extends ApplicationCommandOptionType.Boolean
          ? boolean

          : T extends ApplicationCommandOptionType.User
            ? APIGuildMember & { user: APIUser; permissions: Permissions }

            : T extends ApplicationCommandOptionType.Channel
              ? APIPartialChannel & { permissions: Permissions }

              : T extends ApplicationCommandOptionType.Role
                ? APIRole
                : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type OptionToObject<O> = O extends {
  name: infer K;
  type: infer T;
  required?: infer R;
  options?: infer O;
  choices?: infer C;
}
  ? K extends string
    ? R extends true
      ? { [k in K]: TypeIdToType<T, O, C> }
      : T extends
      | ApplicationCommandOptionType.Subcommand
      | ApplicationCommandOptionType.SubcommandGroup
        ? { [k in K]: TypeIdToType<T, O, C> }
        : { [k in K]?: TypeIdToType<T, O, C> }
    : never
  : never;

type ArgumentsOfRaw<O> = O extends readonly any[] ? UnionToIntersection<OptionToObject<O[number]>> : never;

type ArgumentsOfChatCommand<C extends Command> = C extends { options: readonly Option[] }
  ? Simplify<UnionToIntersection<OptionToObject<C['options'][number]>>>
  : unknown;

export type ArgumentsOf<C extends Command> = C extends { readonly type: ApplicationCommandType.User }
  ? { user: APIUser }
  : C extends { readonly type: ApplicationCommandType.Message }
    ? { message: APIMessage }
    : ArgumentsOfChatCommand<C>;
