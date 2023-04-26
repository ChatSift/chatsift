import { REST } from '@discordjs/rest';
import { Result } from '@sapphire/result';
import type {
	RESTPostAPIChannelMessageJSONBody,
	RESTPostAPICurrentUserCreateDMChannelJSONBody,
	RESTPostAPICurrentUserCreateDMChannelResult,
} from 'discord-api-types/v10';
import { Routes } from 'discord-api-types/v10';
import { container } from 'tsyringe';

export enum DMUserFailableSteps {
	MemberCheck,
	ChannelCreation,
	Message,
}

export interface DMUserError {
	exception?: unknown;
	step: DMUserFailableSteps;
}

export type DMUserResult = Result<void, DMUserError>;

export async function dmUser(userId: string, content: string, guildId?: string): Promise<DMUserResult> {
	const rest = container.resolve(REST);

	if (guildId) {
		const member = await rest.get(Routes.guildMember(guildId, userId)).catch(() => null);
		if (!member) {
			return Result.err<DMUserError>({ step: DMUserFailableSteps.MemberCheck });
		}
	}

	const dmChannelResult = await Result.fromAsync(async () => {
		const body: RESTPostAPICurrentUserCreateDMChannelJSONBody = { recipient_id: userId };
		return (await rest.post(Routes.userChannels(), { body })) as RESTPostAPICurrentUserCreateDMChannelResult;
	});

	if (dmChannelResult.isErr()) {
		return dmChannelResult.mapErr((exception) => ({ step: DMUserFailableSteps.ChannelCreation, exception }));
	}

	const result = await Result.fromAsync(async () => {
		const dmChannel = dmChannelResult.unwrap();
		const body: RESTPostAPIChannelMessageJSONBody = { content };
		await rest.post(Routes.channelMessages(dmChannel.id), { body });
	});

	return result.mapErr((exception) => ({ step: DMUserFailableSteps.Message, exception }));
}
