import { CoralCommandHandler } from './command-framework/CoralCommandHandler.js';
import { ICommandHandler } from './command-framework/ICommandHandler.js';
import { globalContainer } from './container.js';
import { IDatabase } from './database/IDatabase.js';
import { KyselyPostgresDatabase } from './database/KyselyPostgresDatabase.js';
import { ExperimentHandler } from './experiments/ExperimentHandler.js';
import { IExperimentHandler } from './experiments/IExperimentHandler.js';

globalContainer.bind<ICommandHandler<unknown>>(ICommandHandler).to(CoralCommandHandler);
globalContainer.bind<IDatabase>(IDatabase).to(KyselyPostgresDatabase);
globalContainer.bind<IExperimentHandler>(IExperimentHandler).to(ExperimentHandler);
