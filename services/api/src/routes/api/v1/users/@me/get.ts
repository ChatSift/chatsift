import { Route, userAuth } from '@automoderator/rest';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';

@injectable()
export default class GetDevTokenRoute extends Route {
  public override readonly middleware = [userAuth()];

  public handle(req: Request, res: Response) {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    return res.end(JSON.stringify(req.user!));
  }
}
