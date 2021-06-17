import { readFileSync } from 'fs';
import { singleton } from 'tsyringe';
import { join as joinPath } from 'path';

@singleton()
export class UrlsModule {
  public readonly urlRegex = /([^\.\s]+\.)+([^\.]+?)\b/gm;
  public readonly tlds: Set<string>;

  public constructor() {
    const contents = readFileSync(joinPath(__dirname, '..', '..', 'tlds.txt'), 'utf8');
    this.tlds = contents
      .split('\n')
      .reduce((acc, line) => {
        if (!line.startsWith('#')) {
          acc.add(line);
        }

        return acc;
      }, new Set<string>());
  }

  public precheck(content: string): string | null {
    const matches = this.urlRegex.exec(content);
    if (!matches) return null;

    const { tld } = matches.groups!;
    if (!this.tlds.has(tld!)) return null;

    return matches[0]!;
  }
}
