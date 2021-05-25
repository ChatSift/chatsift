import type { Boom } from '@hapi/boom';
import type { Response } from 'polka';

export const sendBoom = (e: Boom, res: Response) => {
  res.statusCode = e.output.statusCode;
  for (const [header, value] of Object.entries(e.output.headers)) {
    res.setHeader(header, value!);
  }

  return res.end(JSON.stringify(e.output.payload));
};
