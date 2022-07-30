import type { RunnerResult, FilterIgnoresResolvable } from '@automoderator/broker-types';
import type { APIMessage } from 'discord-api-types/v9';

type MaybePromise<T> = T | Promise<T>;

export interface IRunner<Transform = unknown, Result = Transform, Log extends RunnerResult = RunnerResult> {
	readonly ignore: FilterIgnoresResolvable | null;

	transform?: (message: APIMessage) => MaybePromise<Transform>;
	check?: (data: Transform, message: APIMessage) => MaybePromise<boolean>;
	run: (data: Transform, message: APIMessage) => MaybePromise<Result | null>;
	cleanup?: (result: Result, message: APIMessage) => MaybePromise<void>;
	log: (result: Result, message: APIMessage) => MaybePromise<Log>;
}
