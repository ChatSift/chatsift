import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const AMAQuestionState = {
    PENDING_MOD_REVIEW: "PENDING_MOD_REVIEW",
    PENDING_GUEST_REVIEW: "PENDING_GUEST_REVIEW",
    FLAGGED: "FLAGGED",
    APPROVED: "APPROVED",
    DENIED: "DENIED"
} as const;
export type AMAQuestionState = (typeof AMAQuestionState)[keyof typeof AMAQuestionState];
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
    state: Generated<AMAQuestionState>;
    content: string;
    modQueueMessageId: string | null;
    guestQueueMessageId: string | null;
    flaggedQueueMessageId: string | null;
    answersMessageId: string | null;
    createdAt: Generated<Timestamp>;
    updatedAt: Generated<Timestamp>;
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
    allowedQuestionUploads: Generated<number>;
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
