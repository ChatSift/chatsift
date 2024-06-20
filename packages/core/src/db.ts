import type { ColumnType } from 'kysely';
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
	? ColumnType<S, I | undefined, U>
	: ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type Experiment = {
	name: string;
	createdAt: Generated<Timestamp>;
	updatedAt: Timestamp | null;
	rangeStart: number;
	rangeEnd: number;
	active: Generated<boolean>;
};
export type ExperimentOverride = {
	id: Generated<number>;
	guildId: string;
	experimentName: string;
};
export type DB = {
	Experiment: Experiment;
	ExperimentOverride: ExperimentOverride;
};
