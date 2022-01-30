import type {
	APIMessage,
	APIUser,
	GatewayDispatchEvents,
	GatewayDispatchPayload,
	Snowflake,
} from 'discord-api-types/v9';
import type { ApiPostFiltersFilesResult, HttpCase } from './api';
import type { BannedWord, CaseAction, MaliciousUrl, WarnPunishmentAction } from './models';

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

interface WarnCaseExtrasNoDuration {
	triggered: WarnPunishmentAction.kick;
}

interface WarnCaseExtrasWithDuration {
	triggered: WarnPunishmentAction.mute | WarnPunishmentAction.ban;
	duration?: number;
	extendedBy?: number;
}

export type WarnCaseExtras = WarnCaseExtrasNoDuration | WarnCaseExtrasWithDuration;

export type NonWarnCase = Omit<HttpCase, 'action_type'> & { action_type: Exclude<CaseAction, CaseAction.warn> };
export type WarnCase = Omit<HttpCase, 'action_type'> & {
	action_type: CaseAction.warn;
	extra?: WarnCaseExtras;
};

type OrArray<T> = T | T[];
export type ModActionLog = LogBase<LogTypes.modAction, OrArray<NonWarnCase | WarnCase>>;

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

export interface BaseRunnerResult {
	runner: Runners;
}

export interface NotOkRunnerResult extends BaseRunnerResult {
	ok: false;
}

export interface OkRunnerResult<R extends Runners, T> extends BaseRunnerResult {
	ok: true;
	runner: R;
	data: T;
	actioned: boolean;
}

export type WordsRunnerResultData = BannedWord & { isUrl: boolean };

export type FilesRunnerResult = OkRunnerResult<Runners.files, ApiPostFiltersFilesResult>;
export type GlobalsRunnerResult = OkRunnerResult<Runners.globals, (MaliciousUrl | { url: string })[]>;
export type InvitesRunnerResult = OkRunnerResult<Runners.invites, string[]>;
export type UrlsRunnerResult = OkRunnerResult<Runners.urls, string[]>;
export type WordsRunnerResult = OkRunnerResult<Runners.words, WordsRunnerResultData[]>;
export type AntispamRunnerResult = OkRunnerResult<
	Runners.antispam,
	{ messages: APIMessage[]; amount: number; time: number }
>;
export type MentionsRunnerResult = OkRunnerResult<
	Runners.mentions,
	| {
			message: APIMessage;
			amount: number;
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

export type NsfwRunnerResult = OkRunnerResult<
	Runners.nsfw,
	{
		message: APIMessage;
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
	| NotOkRunnerResult
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
	triggers: Exclude<RunnerResult, NotOkRunnerResult>[];
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
