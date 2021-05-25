/* istanbul ignore file */
import cookie from 'cookie';
import type { Request, Response, NextHandler } from 'polka';

declare module 'http' {
  export interface ServerResponse {
    append: (header: string, value: any) => void;
    redirect: (redirect: string) => void;
    cookie: (name: string, data: string, options?: cookie.CookieSerializeOptions) => void;
  }
}

export const attachHttpUtils = () => (_: Request, res: Response, next: NextHandler) => {
  res.append = (header, value) => {
    const prev = res.getHeader(header);
    if (prev) value = Array.isArray(prev) ? prev.concat(value) : [prev].concat(value);
    res.setHeader(header, value);
  };

  res.redirect = redirect => {
    res.statusCode = 302;
    res.append('Location', redirect);
    res.append('Content-Length', 0);
  };

  res.cookie = (name, data, options) => {
    const value = cookie.serialize(name, data, options);
    res.append('Set-Cookie', value);
  };

  return next();
};
