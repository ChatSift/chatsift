import { AssignablesController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { conflict } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class PutGuildsAssignablesRoleRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: AssignablesController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { gid, rid } = req.params as { gid: Snowflake; rid: Snowflake };

    const existing = await this.controller.getAll(gid);
    if (existing.length >= 25) {
      return next(conflict('There are already 25 self assignable roles in your server'));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const assignable = await this.controller.add(gid, rid);

    if (!assignable) {
      return next(conflict('That role is already on the list'));
    }

    return res.end(JSON.stringify(assignable));
  }
}
