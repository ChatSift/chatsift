/* istanbul ignore file */
import {
	APIApplicationCommandInteractionData,
	APIApplicationCommandInteractionDataOption,
	APIChatInputApplicationCommandInteractionDataResolved,
	ApplicationCommandOptionType,
	ApplicationCommandType,
} from 'discord-api-types/v9';

const transformChatInteraction = (
	options: APIApplicationCommandInteractionDataOption[],
	resolved: APIChatInputApplicationCommandInteractionDataResolved,
	opts: Record<string, any> = {},
): any => {
	if (options.length === 0) {
		return opts;
	}

	const top = options.shift();
	if (!top) {
		return opts;
	}

	switch (top.type) {
		case ApplicationCommandOptionType.Subcommand:
		case ApplicationCommandOptionType.SubcommandGroup: {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			opts[top.name] = transformChatInteraction(top.options ?? [], resolved);
			break;
		}

		case ApplicationCommandOptionType.User: {
			const user = resolved.users?.[top.value];
			const member = {
				...resolved.members?.[top.value],
				user,
			};

			opts[top.name] = member;
			break;
		}

		case ApplicationCommandOptionType.Channel: {
			opts[top.name] = resolved.channels?.[top.value];
			break;
		}

		case ApplicationCommandOptionType.Role: {
			opts[top.name] = resolved.roles?.[top.value];
			break;
		}

		default: {
			opts[top.name] = top.value;
			break;
		}
	}

	return transformChatInteraction(options, resolved, opts);
};

export const transformInteraction = (data: APIApplicationCommandInteractionData) => {
	switch (data.type) {
		case ApplicationCommandType.ChatInput: {
			return transformChatInteraction(data.options ?? [], data.resolved ?? {});
		}

		case ApplicationCommandType.User: {
			const user = Object.values(data.resolved.users)[0]!;
			return {
				user: {
					...Object.values(data.resolved.members!)[0]!,
					user,
				},
			};
		}

		case ApplicationCommandType.Message: {
			return {
				message: Object.values(data.resolved.messages)[0]!,
			};
		}
	}
};
