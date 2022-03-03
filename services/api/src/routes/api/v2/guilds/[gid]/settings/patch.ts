import { jsonParser, Route, validate } from '@chatsift/rest-utils';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import { userOrThirdPartyAuth } from '#middleware';
import { PrismaClient } from '@prisma/client';
import { PatchGuildsSettingsBody, PatchGuildsSettingsBodySchema } from '@chatsift/api-wrapper';

@injectable()
export default class extends Route {
	public override readonly middleware = [userOrThirdPartyAuth(), jsonParser(), validate(PatchGuildsSettingsBodySchema)];

	public constructor(public readonly prisma: PrismaClient) {
		super();
	}

	public async handle(req: Request, res: Response) {
		const { gid } = req.params as { gid: Snowflake };
		const { modRoles, adminRoles, ...data } = req.body as PatchGuildsSettingsBody;

		res.statusCode = 200;
		res.setHeader('content-type', 'application/json');

		const settings = await this.prisma.guildSettings.upsert({
			create: { guildId: gid, ...data },
			update: data,
			where: { guildId: gid },
		});

		if (modRoles !== undefined) {
			await this.prisma.$transaction(async (prisma) => {
				await prisma.modRole.deleteMany({ where: { guildId: gid } });
				await prisma.modRole.createMany({
					data: modRoles?.map((role) => ({ guildId: gid, roleId: role })) ?? [],
				});
			});
		}

		if (adminRoles !== undefined) {
			await this.prisma.$transaction(async (prisma) => {
				await prisma.modRole.deleteMany({ where: { guildId: gid } });
				await prisma.modRole.createMany({
					data: adminRoles?.map((role) => ({ guildId: gid, roleId: role })) ?? [],
				});
			});
		}

		return res.end(JSON.stringify(settings));
	}
}
