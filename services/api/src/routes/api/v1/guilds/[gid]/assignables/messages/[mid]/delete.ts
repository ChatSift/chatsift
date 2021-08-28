import { AssignablesController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types/v9';
import type { NextHandler, Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class DeleteGuildsAssignablesMessageRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: AssignablesController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { mid } = req.params as { mid: Snowflake };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const assignables = await this.controller.deleteAllForMessage(mid);

    if (!assignables.length) {
      return next(notFound('There were no self assignable roles to delete'));
    }

    return res.end(JSON.stringify(assignables));
  }
}
