import { Route } from '@automoderator/rest';
import { injectable } from 'tsyringe';
import type { Request, Response } from 'polka';

@injectable()
export default class GetV1Route extends Route {
  public handle(_: Request, res: Response) {
    res.statusCode = 204;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify({}));
  }
}
