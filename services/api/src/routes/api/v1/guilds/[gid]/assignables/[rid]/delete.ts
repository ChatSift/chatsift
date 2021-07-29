import { injectable } from 'tsyringe';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { AssignablesController } from '#controllers';
import { notFound } from '@hapi/boom';
import type { Request, Response, NextHandler } from 'polka';
import type { Snowflake } from 'discord-api-types/v9';

@injectable()
export default class DeleteGuildsAssignablesRoleRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: AssignablesController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { rid } = req.params as { rid: Snowflake };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const assignable = await this.controller.delete(rid);

    if (!assignable) {
      return next(notFound('There was no self assignable role to delete'));
    }

    return res.end(JSON.stringify(assignable));
  }
}
