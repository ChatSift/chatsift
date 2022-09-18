import type { RunnerResult, FilterIgnoresResolvable } from '@automoderator/broker-types';
import type { APIMessage } from 'discord-api-types/v9';

type MaybePromise<T> = Promise<T> | T;

export type IRunner<Transform = unknown, Result = Transform, Log extends RunnerResult = RunnerResult> = {
	check?(data: Transform, message: APIMessage): MaybePromise<boolean>;

	cleanup?(result: Result, message: APIMessage): MaybePromise<void>;
	readonly ignore: FilterIgnoresResolvable | null;
	log(result: Result, message: APIMessage): MaybePromise<Log>;
	run(data: Transform, message: APIMessage): MaybePromise<Result | null>;
	transform?(message: APIMessage): MaybePromise<Transform>;
};
