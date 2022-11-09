import type { ValueResolvable } from '@sapphire/bitfield';
import { BitField } from '@sapphire/bitfield';

export enum Runners {
	noop,
}

export type BaseRunnerResult<R extends Runners, T> = {
	data: T;
	runner: R;
};

export type NoopRunnerResult = BaseRunnerResult<Runners.noop, null>;

export type RunnerResult = NoopRunnerResult;

export const FilterIgnoresTypes = {
	urls: 1n << 0n,
	// eslint-disable-next-line sonarjs/no-identical-expressions
	files: 1n << 1n,
	invites: 1n << 2n,
	words: 1n << 3n,
	automod: 1n << 4n,
	global: 1n << 5n,
};
export const FilterIgnoresBitfield = new BitField(FilterIgnoresTypes);
export type FilterIgnoresResolvable = ValueResolvable<typeof FilterIgnoresBitfield>;
