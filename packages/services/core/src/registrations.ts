import { globalContainer } from './container.js';
import { IDatabase } from './database/IDatabase.js';
import { KyselyPostgresDatabase } from './database/KyselyPostgresDatabase.js';
import { ExperimentHandler } from './experiments/ExperimentHandler.js';
import { IExperimentHandler } from './experiments/IExperimentHandler.js';

globalContainer.bind<IDatabase>(IDatabase).to(KyselyPostgresDatabase);
globalContainer.bind<IExperimentHandler>(IExperimentHandler).to(ExperimentHandler);
