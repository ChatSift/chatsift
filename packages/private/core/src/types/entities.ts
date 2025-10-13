import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export type AMAQuestion = {
    id: Generated<number>;
    amaId: number;
    authorId: string;
    content: string;
    imageUrl: string | null;
    answerMessageId: string | null;
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
    promptMessageId: string;
    ended: Generated<boolean>;
    createdAt: Generated<Timestamp>;
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
    AMAQuestion: AMAQuestion;
    AMASession: AMASession;
    Experiment: Experiment;
    ExperimentOverride: ExperimentOverride;
};
