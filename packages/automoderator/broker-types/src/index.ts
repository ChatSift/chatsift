import type {
	APIMessage,
	APIUser,
	GatewayDispatchEvents,
	GatewayDispatchPayload,
	Snowflake,
} from 'discord-api-types/v9';
import type { BannedWord, Case, MaliciousFile, MaliciousUrl } from '@prisma/client';

type SanitizedDiscordEvents = {
	[K in GatewayDispatchEvents]: GatewayDispatchPayload & {
		t: K;
	};
};

export type DiscordEvents = {
	[K in keyof SanitizedDiscordEvents]: SanitizedDiscordEvents[K]['d'];
};

export enum LogTypes {
	modAction,
	filterTrigger,
	server,
	forbiddenName,
}

export interface LogBase<T extends LogTypes, D extends Record<string, any>> {
	type: T;
	data: D;
}

export type ModActionLog = LogBase<LogTypes.modAction, Case | Case[]>;

export enum Runners {
	files,
	invites,
	urls,
	words,
	antispam,
	mentions,
	globals,
	nsfw,
}

export interface BaseRunnerResult<R extends Runners, T> {
	runner: R;
	data: T;
}

export type WordsRunnerResultData = BannedWord & { isUrl: boolean };

export type FilesRunnerResult = BaseRunnerResult<Runners.files, MaliciousFile[]>;
export type GlobalsRunnerResult = BaseRunnerResult<Runners.globals, (MaliciousUrl | { url: string })[]>;
export type InvitesRunnerResult = BaseRunnerResult<Runners.invites, string[]>;
export type UrlsRunnerResult = BaseRunnerResult<Runners.urls, string[]>;
export type WordsRunnerResult = BaseRunnerResult<Runners.words, WordsRunnerResultData[]>;
export type AntispamRunnerResult = BaseRunnerResult<
	Runners.antispam,
	{ messages: APIMessage[]; amount: number; time: number }
>;
export type MentionsRunnerResult = BaseRunnerResult<
	Runners.mentions,
	| {
			limit: number;
	  }
	| {
			messages: APIMessage[];
			amount: number;
			time: number;
	  }
>;

export type PredictionType = 'neutral' | 'drawing' | 'hentai' | 'porn' | 'sexy';

export interface NsfwApiData {
	url: string;
	thumbnail_url: string;
	predictions: {
		className: 'Neutral' | 'Drawing' | 'Hentai' | 'Porn' | 'Sexy';
		probability: number;
	}[];
}

export type NsfwRunnerResult = BaseRunnerResult<
	Runners.nsfw,
	{
		predictions: Record<PredictionType, number>;
		crossed: Exclude<PredictionType, 'neutral' | 'drawing'>[];
		url: string;
		thumbnail_url: string;
		thresholds: {
			hentai?: number | null;
			porn?: number | null;
			sexy?: number | null;
		};
	} | null
>;

export type RunnerResult =
	| FilesRunnerResult
	| InvitesRunnerResult
	| UrlsRunnerResult
	| GlobalsRunnerResult
	| WordsRunnerResult
	| AntispamRunnerResult
	| MentionsRunnerResult
	| NsfwRunnerResult;

export interface FilterTriggerData {
	message: APIMessage;
	triggers: RunnerResult[];
}

export type FilterTriggerLog = LogBase<LogTypes.filterTrigger, FilterTriggerData>;

export enum ServerLogType {
	nickUpdate,
	usernameUpdate,
	messageEdit,
	messageDelete,
	filterUpdate,
}

export interface ServerLogBase<T extends ServerLogType, D> {
	type: T;
	data: D;
}

export type ServerNickUpdateLog = ServerLogBase<ServerLogType.nickUpdate, { o: string | null; n: string | null }>;
export type ServerUsernameUpdateLog = ServerLogBase<ServerLogType.usernameUpdate, { o: string; n: string }>;
export type ServerMessageEditLog = ServerLogBase<
	ServerLogType.messageEdit,
	{ message: APIMessage; o: string; n: string }
>;
export type ServerMessageDeleteLog = ServerLogBase<
	ServerLogType.messageDelete,
	{ message: APIMessage; hadAttachments: boolean; mod?: APIUser }
>;
export type ServerFilterUpdateLog = ServerLogBase<
	ServerLogType.filterUpdate,
	{ added: BannedWord[]; removed: BannedWord[] }
>;

export type ServerLogs =
	| ServerNickUpdateLog
	| ServerUsernameUpdateLog
	| ServerMessageEditLog
	| ServerMessageDeleteLog
	| ServerFilterUpdateLog;

type _GroupedServerLogs = {
	[T in ServerLogType]: ServerLogs & { type: T };
};

export type GroupedServerLogs = {
	[K in ServerLogType]: _GroupedServerLogs[K]['data'][];
};

export interface ServerLogData {
	guild: Snowflake;
	user: APIUser;
	logs: ServerLogs[];
}

export type ServerLog = LogBase<LogTypes.server, ServerLogData>;

export type ForbiddenNameLog = LogBase<
	LogTypes.forbiddenName,
	{
		guildId: string;
		words: string[];
		user: APIUser;
		nick: boolean;
		before: string;
		after: string;
	}
>;

export type Log = ModActionLog | FilterTriggerLog | ServerLog | ForbiddenNameLog;
