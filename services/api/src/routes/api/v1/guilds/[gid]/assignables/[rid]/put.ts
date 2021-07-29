import { injectable } from 'tsyringe';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { AssignablesController } from '#controllers';
import { conflict } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';

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
    if (existing.length > 15) {
      return next(conflict('There are already 15 self assignable roles in your server'));
    }

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const assignable = await this.controller.add(gid, rid);

    if (!assignable) {
      return next(conflict('That self assignable role already existed'));
    }

    return res.end(JSON.stringify(assignable));
  }
}
