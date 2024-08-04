import { globalContainer } from '@chatsift/service-core';
import { INotifier } from './notifications/INotifier.js';
import { Notifier } from './notifications/Notifier.js';

globalContainer.bind<INotifier>(INotifier).to(Notifier);
