import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type AMAPromptData = {
    id: Generated<number>;
    amaId: number;
    promptMessageId: string;
    promptJSONData: string;
};
export type AMAQuestion = {
    id: Generated<number>;
    amaId: number;
    authorId: string;
};
export type AMASession = {
    id: Generated<number>;
    guildId: string;
    modQueueId: string | null;
    flaggedQueueId: string | null;
    guestQueueId: string | null;
    title: string;
    answersChannelId: string;
    promptChannelId: string;
    ended: Generated<boolean>;
    createdAt: Generated<Timestamp>;
};
export type DashboardGrant = {
    id: Generated<number>;
    guildId: string;
    userId: string;
    createdById: string;
};
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
export type DB = {
    AMAPromptData: AMAPromptData;
    AMAQuestion: AMAQuestion;
    AMASession: AMASession;
    DashboardGrant: DashboardGrant;
    Experiment: Experiment;
    ExperimentOverride: ExperimentOverride;
};
