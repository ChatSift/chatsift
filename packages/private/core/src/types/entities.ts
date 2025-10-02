import type { ColumnType } from "kysely";
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
};
export type ExperimentOverride = {
    id: Generated<number>;
    guildId: string;
    experimentName: string;
};
export type Incident = {
    id: Generated<number>;
    stack: string;
    causeStack: string | null;
    guildId: string | null;
    createdAt: Generated<Timestamp>;
    resolved: Generated<boolean>;
};
export type DB = {
    Experiment: Experiment;
    ExperimentOverride: ExperimentOverride;
    Incident: Incident;
};
