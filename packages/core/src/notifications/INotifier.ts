import {
	type APIEmbed,
	type APIMessage,
	type APIUser,
	type RESTPostAPIChannelMessageJSONBody,
	type Snowflake,
} from '@discordjs/core';
import { injectable } from 'inversify';
import type { Selectable } from 'kysely';
import type { ModCase } from '../db.js';

export interface DMUserOptions {
	bindToGuildId?: Snowflake;
	data: RESTPostAPIChannelMessageJSONBody;
	userId: Snowflake;
}

export interface LogModCaseOptions {
	existingMessage?: APIMessage;
	mod: APIUser | null;
	modCase: Selectable<ModCase>;
	target: APIUser | null;
}

@injectable()
export abstract class INotifier {
	public constructor() {
		if (this.constructor === INotifier) {
			throw new Error('This class cannot be instantiated.');
		}
	}

	public abstract tryDMUser(options: DMUserOptions): Promise<boolean>;

	public abstract generateModCaseEmbed(options: LogModCaseOptions): Promise<APIEmbed>;
	public abstract logModCase(options: LogModCaseOptions): Promise<void>;
	public abstract tryNotifyTargetModCase(modCase: Selectable<ModCase>): Promise<boolean>;
}
