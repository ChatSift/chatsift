import { RaidCleanupCommand } from '#interactions';
import { ArgumentsOf, ControlFlowError, kGatewayBroadcasts, RaidCleanupMember, RaidCleanupMembersStore, send } from '#util';
import { DiscordEvents, ms } from '@automoderator/core';
import { UserPerms } from '@automoderator/discord-permissions';
import { kLogger } from '@automoderator/injection';
import { PubSubPublisher, RoutingSubscriber } from '@cordis/brokers';
import { Rest as DiscordRest } from '@cordis/rest';
import { getCreationData } from '@cordis/util';
import {
  APIGuildInteraction,
  APIGuildMember,
  GatewaySendPayload,
  GatewayGuildMembersChunkDispatchData,
  GatewayDispatchEvents,
  GatewayOpcodes,
  InteractionResponseType,
  Snowflake,
  ComponentType,
  ButtonStyle
} from 'discord-api-types/v9';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';
import { inject, injectable } from 'tsyringe';
import { Command } from '../../command';

@injectable()
export default class implements Command {
  public readonly userPermissions = UserPerms.mod;

  public constructor(
    public readonly raidCleanupMembers: RaidCleanupMembersStore,
    public readonly discordRest: DiscordRest,
    public readonly gateway: RoutingSubscriber<keyof DiscordEvents, DiscordEvents>,
    @inject(kGatewayBroadcasts) public readonly gatewayBroadcaster: PubSubPublisher<GatewaySendPayload>,
    @inject(kLogger) public readonly logger: Logger
  ) {}

  private _fetchGuildMembers(guildId: Snowflake): Promise<APIGuildMember[]> {
    return new Promise(resolve => {
      const members: APIGuildMember[] = [];
      let index = 0;

      const handler = (chunk: GatewayGuildMembersChunkDispatchData) => {
        index++;

        for (const member of chunk.members) {
          if (member.user) {
            members.push(member);
          }
        }

        if (index++ === chunk.chunk_count) {
          this.gateway.off(GatewayDispatchEvents.GuildMembersChunk, handler);
          this.logger.debug({ members: members.length }, 'Collected guild members in raid-cleanup');
          return resolve(members);
        }
      };

      this.gateway.on(GatewayDispatchEvents.GuildMembersChunk, handler);
      this.gatewayBroadcaster.publish({
        op: GatewayOpcodes.RequestGuildMembers,
        d: {
          guild_id: guildId,
          query: '',
          limit: 0
        }
      });
    });
  }

  public parse(args: ArgumentsOf<typeof RaidCleanupCommand>) {
    return {
      join: args.join,
      age: args.age
    };
  }

  public async exec(interaction: APIGuildInteraction, args: ArgumentsOf<typeof RaidCleanupCommand>) {
    await send(interaction, {}, InteractionResponseType.DeferredChannelMessageWithSource);

    const { join, age } = this.parse(args);

    if (join == null && age == null) {
      throw new ControlFlowError('You must pass at least one of the given arguments');
    }

    let joinCutOff: number | undefined;
    if (join) {
      const joinMinutesAgo = Number(join);

      if (isNaN(joinMinutesAgo)) {
        const joinAgo = ms(join);
        if (!joinAgo) {
          throw new ControlFlowError('Failed to parse the provided join time');
        }

        joinCutOff = Date.now() - joinAgo;
      } else {
        joinCutOff = Date.now() - (joinMinutesAgo * 6e4);
      }
    }

    let ageCutOff: number | undefined;
    if (age) {
      const ageMinutesAgo = Number(age);

      if (isNaN(ageMinutesAgo)) {
        const ageAgo = ms(age);
        if (!ageAgo) {
          throw new ControlFlowError('Failed to parse the provided age time');
        }

        ageCutOff = Date.now() - ageAgo;
      } else {
        ageCutOff = Date.now() - (ageMinutesAgo * 6e4);
      }
    }

    this.logger.debug({ joinCutOff, ageCutOff }, 'Running raid-cleanup');

    await send(interaction, { content: 'Collecting all of your server members...' });
    const allMembers = await this._fetchGuildMembers(interaction.guild_id);

    await send(interaction, { content: 'Selecting members that match your criteria...' });

    const members = allMembers.reduce<RaidCleanupMember[]>((acc, member) => {
      let meetsJoinCriteria = true;
      let meetsAgeCriteria = true;

      if (joinCutOff) {
        meetsJoinCriteria = new Date(member.joined_at).getTime() > joinCutOff;
      }

      if (ageCutOff) {
        const { createdTimestamp } = getCreationData(member.user!.id);
        meetsAgeCriteria = createdTimestamp > ageCutOff;
      }

      if (meetsJoinCriteria && meetsAgeCriteria) {
        acc.push({ id: member.user!.id, tag: `${member.user!.username}#${member.user!.discriminator}` });
      }

      return acc;
    }, []);

    if (!members.length) {
      const joinInfo = joinCutOff ? `\nAccounts that joined ${ms(Date.now() - joinCutOff, true)} ago` : '';
      const ageInfo = ageCutOff ? `\nAccounts that were created ${ms(Date.now() - ageCutOff, true)} ago` : '';

      return send(interaction, {
        content: `There were no members that matched the given criteria. Searched for:${joinInfo}${ageInfo}`
      });
    }

    const id = nanoid();

    void this.raidCleanupMembers.set(id, members);
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setTimeout(async () => {
      if (await this.raidCleanupMembers.delete(id)) {
        void send(interaction, { components: [] });
        void send(interaction, { content: 'Timed out.' }, InteractionResponseType.ChannelMessageWithSource, true);
      }
    }, 2e4);

    return send(interaction, {
      content: `Are you absolutely sure you want to nuke these ${members.length} users?`,
      files: [{
        name: 'targets.txt',
        content: Buffer.from(members.map(m => m.id).join('\n'))
      }],
      components: [
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              label: 'Cancel',
              style: ButtonStyle.Secondary,
              custom_id: `confirm-raid-cleanup|${id}|n`
            },
            {
              type: ComponentType.Button,
              label: 'Confirm',
              style: ButtonStyle.Success,
              custom_id: `confirm-raid-cleanup|${id}|y`
            }
          ]
        }
      ]
    });
  }
}
