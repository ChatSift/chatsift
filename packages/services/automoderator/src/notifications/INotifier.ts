import { ModCaseKind, type CaseWithLogMessage, type ModCase } from '@chatsift/service-core';
import {
	type APIEmbed,
	type APIMessage,
	type APIUser,
	type RESTPostAPIChannelMessageJSONBody,
	type Snowflake,
} from '@discordjs/core';
import { injectable } from 'inversify';
import type { Selectable } from 'kysely';

export interface DMUserOptions {
	bindToGuildId?: Snowflake;
	data: RESTPostAPIChannelMessageJSONBody;
	userId: Snowflake;
}

export interface LogModCaseOptions {
	existingMessage?: APIMessage;
	mod: APIUser | null;
	modCase: Selectable<ModCase>;
	references: CaseWithLogMessage[];
	target: APIUser | null;
}

export interface HistoryEmbedOptions {
	cases: CaseWithLogMessage[];
	target: APIUser;
}

@injectable()
export abstract class INotifier {
	public readonly ACTION_COLORS_MAP = {
		[ModCaseKind.Warn]: 0xf47b7b,
		[ModCaseKind.Timeout]: 0xf47b7b,
		[ModCaseKind.Untimeout]: 0x5865f2,
		[ModCaseKind.Kick]: 0xf47b7b,
		[ModCaseKind.Ban]: 0xf04848,
		[ModCaseKind.Unban]: 0x5865f2,
	} as const satisfies Record<ModCaseKind, number>;

	public readonly ACTION_VERBS_MAP = {
		[ModCaseKind.Warn]: 'warned',
		[ModCaseKind.Timeout]: 'timed out',
		[ModCaseKind.Untimeout]: 'untimed out',
		[ModCaseKind.Kick]: 'kicked',
		[ModCaseKind.Ban]: 'banned',
		[ModCaseKind.Unban]: 'unbanned',
	} as const satisfies Record<ModCaseKind, string>;

	public constructor() {
		if (this.constructor === INotifier) {
			throw new Error('This class cannot be instantiated.');
		}
	}

	public abstract tryDMUser(options: DMUserOptions): Promise<boolean>;

	public abstract generateModCaseEmbed(options: LogModCaseOptions): APIEmbed;
	public abstract logModCase(options: LogModCaseOptions): Promise<void>;
	public abstract tryNotifyTargetModCase(modCase: Selectable<ModCase>): Promise<boolean>;
	public abstract generateHistoryEmbed(options: HistoryEmbedOptions): APIEmbed;
}
