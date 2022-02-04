import type { RunnerResult } from '@automoderator/broker-types';
import type { APIMessage } from 'discord-api-types/v9';

type MaybePromise<T> = T | Promise<T>;

export interface IRunner<Transform, Result = Transform, Log extends RunnerResult = RunnerResult> {
	transform?: (message: APIMessage) => MaybePromise<Transform>;
	check?: (data: { message: APIMessage } & Transform, message: APIMessage) => MaybePromise<boolean>;
	run: (data: Transform, message: APIMessage) => MaybePromise<Result | null>;
	cleanup?: (result: Result, message: APIMessage) => MaybePromise<void>;
	log: (result: Result, message: APIMessage) => MaybePromise<Log['data']>;
}
