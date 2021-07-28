import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';
import { ArgumentsOf, ControlFlowError, dmUser, getGuildName, send } from '#util';
import { PermissionsChecker, UserPerms } from '@automoderator/discord-permissions';
import { MuteCommand } from '#interactions';
import { Rest } from '@automoderator/http-client';
import { Rest as DiscordRest } from '@cordis/rest';
import { APIGuildInteraction, APIRole, RESTPatchAPIGuildMemberJSONBody, Routes } from 'discord-api-types/v9';
import { PubSubPublisher } from '@cordis/brokers';
import { kSql } from '@automoderator/injection';
import {
  ApiPostGuildsCasesBody,
  ApiPostGuildsCasesResult,
  Case,
  CaseAction,
  GuildSettings,
  Log,
  LogTypes,
  ms,
  UnmuteRole
} from '@automoderator/core';
import type { Sql } from 'postgres';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly rest: Rest,
    public readonly discordRest: DiscordRest,
    public readonly guildLogs: PubSubPublisher<Log>,
    public readonly checker: PermissionsChecker,
    @inject(kSql) public readonly sql: Sql<{}>
  ) {}

  public parse(args: ArgumentsOf<typeof MuteCommand>) {
    return {
      member: args.user,
      reason: args.reason,
      refId: args.reference,
      duration: args.duration
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof MuteCommand>) {
    const { member, reason, refId, duration: durationString } = this.parse(args);
    if (reason && reason.length >= 1900) {
      throw new ControlFlowError(`Your provided reason is too long (${reason.length}/1900)`);
    }

    if (member.user.id === interaction.member.user.id) {
      throw new ControlFlowError('You cannot ban yourself');
    }

    if (await this.checker.check({ guild_id: interaction.guild_id, member }, UserPerms.mod)) {
      throw new ControlFlowError('You cannot action a member of the staff team');
    }

    const [settings] = await this.sql<[Pick<GuildSettings, 'mute_role'>?]>`
      SELECT mute_role FROM guild_settings
      WHERE guild_id = ${interaction.guild_id}
    `;

    if (!settings?.mute_role) {
      throw new ControlFlowError('This server does not have a configured mute role');
    }

    let expiresAt: Date | undefined;
    if (durationString) {
      const duration = ms(durationString);
      if (!duration) {
        throw new ControlFlowError('Failed to parse the provided duration');
      }

      expiresAt = new Date(Date.now() + duration);
    }

    const [existingMuteCase] = await this.sql<[Case?]>`
      SELECT * FROM cases
      WHERE target_id = ${member.user.id}
        AND action_type = ${CaseAction.mute}
        AND guild_id = ${interaction.guild_id}
        AND processed = false
    `;

    if (existingMuteCase) {
      throw new ControlFlowError('This user has already been muted. If you wish to update the duration please use the `/duration` command');
    }

    const modTag = `${interaction.member.user.username}#${interaction.member.user.discriminator}`;
    const targetTag = `${member.user.username}#${member.user.discriminator}`;

    const guildRoles = new Map(
      await this.discordRest.get<APIRole[]>(`/guilds/${interaction.guild_id}/roles`)
        .catch(() => [] as APIRole[])
        .then(
          roles => roles.map(
            role => [role.id, role]
          )
        )
    );

    const roles = member.roles.filter(r => guildRoles.get(r)!.managed).concat([settings.mute_role]);

    await this.discordRest.patch<unknown, RESTPatchAPIGuildMemberJSONBody>(Routes.guildMember(interaction.guild_id, member.user.id), {
      data: { roles },
      reason: `Mute | By ${modTag}`
    });

    const guildName = await getGuildName(interaction.guild_id);

    const duration = expiresAt ? `. This mute will expire in ${ms(expiresAt.getTime() - Date.now(), true)}` : '';
    await dmUser(member.user.id, `Hello! You have been muted in ${guildName}${duration}.\n\nReason: ${reason ?? 'No reason provided.'}`);

    const [cs] = await this.rest.post<ApiPostGuildsCasesResult, ApiPostGuildsCasesBody>(`/api/v1/guilds/${interaction.guild_id}/cases`, [
      {
        action: CaseAction.mute,
        mod_id: interaction.member.user.id,
        mod_tag: modTag,
        target_id: member.user.id,
        target_tag: targetTag,
        reason,
        reference_id: refId,
        expires_at: expiresAt,
        created_at: new Date()
      }
    ]);

    type SqlNoop<T> = { [K in keyof T]: T[K] };
    const unmuteRoles = member.roles.map<SqlNoop<UnmuteRole>>(role => ({ case_id: cs!.id, role_id: role }));

    if (unmuteRoles.length) {
      await this.sql`INSERT INTO unmute_roles ${this.sql(unmuteRoles)}`;
    }

    await send(interaction, { content: `Successfully muted ${targetTag}` });
    this.guildLogs.publish({
      type: LogTypes.modAction,
      data: cs!
    });
  }
}
