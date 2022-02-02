import type { RunnerResult } from '@automoderator/broker-types';
import type { APIMessage } from 'discord-api-types/v9';

type MaybePromise<T> = T | Promise<T>;

export interface IRunner<
	Transform extends { message: APIMessage } = { message: APIMessage },
	Result = Transform,
	Log extends RunnerResult = RunnerResult,
> {
	transform?: (message: APIMessage) => MaybePromise<Transform>;
	check?: (data: { message: APIMessage } & Transform) => MaybePromise<boolean>;
	run: (data: Transform) => MaybePromise<Result | null>;
	cleanup?: (result: Result) => MaybePromise<void>;
	log: (result: Result) => MaybePromise<Log['data']>;
}
