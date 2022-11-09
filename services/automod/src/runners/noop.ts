import type { NoopRunnerResult } from '@automoderator/common';
import { Runners } from '@automoderator/common';
import { singleton } from 'tsyringe';
import type { Runner } from '../struct/Runner';

@singleton()
export class NoopRunner implements Runner<null, null, NoopRunnerResult> {
	public readonly ignore = 'urls';

	public run() {
		return null;
	}

	public async log() {
		return {
			runner: Runners.noop,
			data: null,
		};
	}
}
