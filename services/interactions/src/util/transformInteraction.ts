import {
  APIApplicationCommandInteractionData,
  APIApplicationCommandInteractionDataOption,
  ApplicationCommandOptionType
} from 'discord-api-types/v8';

type ResolvedApplicationCommandInteractionData = APIApplicationCommandInteractionData['resolved'];

export const transformInteraction = (
  options: APIApplicationCommandInteractionDataOption[],
  resolved: ResolvedApplicationCommandInteractionData,
  opts: Record<string, any> = {}
): any => {
  if (options.length === 0) {
    return opts;
  }

  const top = options.shift();
  if (!top) {
    return opts;
  }

  switch (top.type) {
    case ApplicationCommandOptionType.SubCommand:
    case ApplicationCommandOptionType.SubCommandGroup: {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      opts[top.name] = transformInteraction(top.options ?? [], resolved);
      break;
    }

    case ApplicationCommandOptionType.User: {
      const user = resolved?.users?.[top.value];
      const member = {
        ...resolved?.members?.[top.value],
        user
      };
      opts[top.name] = member;
      break;
    }

    case ApplicationCommandOptionType.Channel: {
      opts[top.name] = resolved?.channels?.[top.value];
      break;
    }

    case ApplicationCommandOptionType.Role: {
      opts[top.name] = resolved?.roles?.[top.value];
      break;
    }

    default: {
      opts[top.name] = top.value;
      break;
    }
  }

  return transformInteraction(options, resolved, opts);
};
