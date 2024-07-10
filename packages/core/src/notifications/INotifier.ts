import { type APIMessage, type RESTPostAPIChannelMessageJSONBody, type Snowflake } from '@discordjs/core';
import type { Selectable } from 'kysely';
import type { ModCase } from '../db.js';

export interface DMUserOptions {
	bindToGuildId?: Snowflake;
	data: RESTPostAPIChannelMessageJSONBody;
	userId: Snowflake;
}

export interface LogModCaseOptions {
	existingMessage?: APIMessage;
	modCase: Selectable<ModCase>;
}

export abstract class INotifier {
	public abstract tryDMUser(options: DMUserOptions): Promise<boolean>;
	public abstract logModCase(options: LogModCaseOptions): Promise<void>;
}
