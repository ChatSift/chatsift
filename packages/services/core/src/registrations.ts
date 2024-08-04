import { CoralCommandHandler } from './command-framework/CoralCommandHandler.js';
import { ICommandHandler } from './command-framework/ICommandHandler.js';
import { globalContainer } from './container.js';

globalContainer.bind<ICommandHandler<unknown>>(ICommandHandler).to(CoralCommandHandler);
