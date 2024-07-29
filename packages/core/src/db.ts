import type { ColumnType } from "kysely";
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export const ModCaseKind = {
    Warn: "Warn",
    Timeout: "Timeout",
    Kick: "Kick",
    Ban: "Ban",
    Untimeout: "Untimeout",
    Unban: "Unban"
} as const;
export type ModCaseKind = (typeof ModCaseKind)[keyof typeof ModCaseKind];
export const LogWebhookKind = {
    Mod: "Mod"
} as const;
export type LogWebhookKind = (typeof LogWebhookKind)[keyof typeof LogWebhookKind];
export type CaseReference = {
    referencedById: number;
    referencesId: number;
};
export type DiscordOAuth2User = {
    id: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Timestamp;
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
export type Incident = {
    id: Generated<number>;
    stack: string;
    causeStack: string | null;
    guildId: string | null;
    createdAt: Generated<Timestamp>;
    resolved: Generated<boolean>;
};
export type LogWebhook = {
    id: Generated<number>;
    guildId: string;
    webhookId: string;
    webhookToken: string;
    threadId: string | null;
    kind: LogWebhookKind;
};
export type ModCase = {
    id: Generated<number>;
    guildId: string;
    kind: ModCaseKind;
    createdAt: Generated<Timestamp>;
    reason: string;
    modId: string;
    targetId: string;
};
export type ModCaseLogMessage = {
    caseId: number;
    messageId: string;
    channelId: string;
};
export type DB = {
    CaseReference: CaseReference;
    DiscordOAuth2User: DiscordOAuth2User;
    Experiment: Experiment;
    ExperimentOverride: ExperimentOverride;
    Incident: Incident;
    LogWebhook: LogWebhook;
    ModCase: ModCase;
    ModCaseLogMessage: ModCaseLogMessage;
};
