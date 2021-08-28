import { AssignablesController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import type { Snowflake } from 'discord-api-types/v9';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class GetGuildsAssignablesMessageRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: AssignablesController
  ) {
    super();
  }

  public async handle(req: Request, res: Response) {
    const { mid } = req.params as { mid: Snowflake };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const assignables = await this.controller.getAllForMessage(mid);
    return res.end(JSON.stringify(assignables));
  }
}
