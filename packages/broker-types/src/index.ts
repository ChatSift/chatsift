/* eslint-disable no-shadow */
import type { BannedWord, Case, MaliciousFile, MaliciousUrl } from "@prisma/client";
import type {
	APIMessage,
	APIUser,
	GatewayDispatchEvents,
	GatewayDispatchPayload,
	GatewayMessageCreateDispatchData,
	Snowflake,
} from "discord-api-types/v9";

type SanitizedDiscordEvents = {
	[K in GatewayDispatchEvents]: GatewayDispatchPayload & {
		t: K;
	};
};

export type DiscordEvents = {
	// @ts-expect-error cause it errors when I don't want it to, why else?
	[K in keyof SanitizedDiscordEvents]: SanitizedDiscordEvents[K]["d"];
};

export enum LogTypes {
	modAction,
	filterTrigger,
	server,
	forbiddenName,
}

export type LogBase<T extends LogTypes, D extends Record<string, any>> = {
	data: D;
	type: T;
};

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

export type BaseRunnerResult<R extends Runners, T> = {
	data: T;
	runner: R;
};

export type WordsRunnerResultData = BannedWord & { isUrl: boolean };

export type FilesRunnerResult = BaseRunnerResult<Runners.files, MaliciousFile[]>;
export type GlobalsRunnerResult = BaseRunnerResult<Runners.globals, (MaliciousUrl | { url: string })[]>;
export type InvitesRunnerResult = BaseRunnerResult<Runners.invites, string[]>;
export type UrlsRunnerResult = BaseRunnerResult<Runners.urls, string[]>;
export type WordsRunnerResult = BaseRunnerResult<Runners.words, WordsRunnerResultData[]>;
export type AntispamRunnerResult = BaseRunnerResult<
	Runners.antispam,
	{ amount: number; messages: APIMessage[]; time: number }
>;
export type MentionsRunnerResult = BaseRunnerResult<
	Runners.mentions,
	| {
			amount: number;
			messages: APIMessage[];
			time: number;
	}
	| {
			limit: number;
	}
>;

export type PredictionType = "drawing" | "hentai" | "neutral" | "porn" | "sexy";

export type NsfwApiData = {
	predictions: {
		className: "Drawing" | "Hentai" | "Neutral" | "Porn" | "Sexy";
		probability: number;
	}[];
	thumbnail_url: string;
	url: string;
};

export type NsfwRunnerResult = BaseRunnerResult<
	Runners.nsfw,
	{
		crossed: Exclude<PredictionType, "drawing" | "neutral">[];
		predictions: Record<PredictionType, number>;
		thresholds: {
			hentai?: number | null;
			porn?: number | null;
			sexy?: number | null;
		};
		thumbnail_url: string;
		url: string;
	} | null
>;

export type RunnerResult =
	| AntispamRunnerResult
	| FilesRunnerResult
	| GlobalsRunnerResult
	| InvitesRunnerResult
	| MentionsRunnerResult
	| NsfwRunnerResult
	| UrlsRunnerResult
	| WordsRunnerResult;

export type FilterTriggerData = {
	message: GatewayMessageCreateDispatchData;
	triggers: RunnerResult[];
};

export type FilterTriggerLog = LogBase<LogTypes.filterTrigger, FilterTriggerData>;

export enum ServerLogType {
	nickUpdate,
	usernameUpdate,
	messageEdit,
	messageDelete,
	filterUpdate,
}

export type ServerLogBase<T extends ServerLogType, D> = {
	data: D;
	type: T;
};

export type ServerNickUpdateLog = ServerLogBase<ServerLogType.nickUpdate, { n: string | null; o: string | null }>;
export type ServerUsernameUpdateLog = ServerLogBase<ServerLogType.usernameUpdate, { n: string; o: string }>;
export type ServerMessageEditLog = ServerLogBase<
	ServerLogType.messageEdit,
	{ message: APIMessage & { guild_id: string }; n: string; o: string }
>;
export type ServerMessageDeleteLog = ServerLogBase<
	ServerLogType.messageDelete,
	{ hadAttachments: boolean; message: APIMessage; mod?: APIUser }
>;
export type ServerFilterUpdateLog = ServerLogBase<
	ServerLogType.filterUpdate,
	{ added: BannedWord[]; removed: BannedWord[] }
>;

export type ServerLogs =
	| ServerFilterUpdateLog
	| ServerMessageDeleteLog
	| ServerMessageEditLog
	| ServerNickUpdateLog
	| ServerUsernameUpdateLog;

type _GroupedServerLogs = {
	[T in ServerLogType]: ServerLogs & { type: T };
};

export type GroupedServerLogs = {
	// @ts-expect-error cause it errors when I don't want it to, why else?
	[K in ServerLogType]: _GroupedServerLogs[K]["data"][];
};

export type ServerLogData = {
	guild: Snowflake;
	logs: ServerLogs[];
	user: APIUser;
};

export type ServerLog = LogBase<LogTypes.server, ServerLogData>;

export type ForbiddenNameLog = LogBase<
	LogTypes.forbiddenName,
	{
		after: string;
		before: string;
		guildId: string;
		nick: boolean;
		user: APIUser;
		words: string[];
	}
>;

export type Log = FilterTriggerLog | ForbiddenNameLog | ModActionLog | ServerLog;

export * from "./bitfields";
