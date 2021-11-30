import { Route, userAuth, getUserGuilds } from '@automoderator/rest';
import type { Request, Response } from 'polka';
import { injectable } from 'tsyringe';
import cookie from 'cookie';

@injectable()
export default class GetUsersMeRoute extends Route {
  public override readonly middleware = [userAuth()];

  public async handle(req: Request, res: Response) {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    const { perms, ...user } = req.user!;

    const cookies = cookie.parse(req.headers.cookie ?? '');
    const token = cookies.access_token ?? req.headers.authorization;

    const guilds = await getUserGuilds(token!);

    return res.end(
      JSON.stringify({
        ...user,
        guilds: [...guilds.values()]
      })
    );
  }
}
