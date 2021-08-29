import { PromptsController } from '#controllers';
import { Route, thirdPartyAuth } from '@automoderator/rest';
import { notFound } from '@hapi/boom';
import type { Snowflake } from 'discord-api-types';
import type { Request, Response, NextHandler } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class GetGuildPromptByMessageRoute extends Route {
  public override readonly middleware = [thirdPartyAuth()];

  public constructor(
    public readonly controller: PromptsController
  ) {
    super();
  }

  public async handle(req: Request, res: Response, next: NextHandler) {
    const { mid } = req.params as { mid: Snowflake };

    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const prompt = await this.controller.getByMessage(mid);

    if (!prompt) {
      return next(notFound('No prompt belonging to that message found'));
    }

    return res.end(JSON.stringify(prompt));
  }
}
