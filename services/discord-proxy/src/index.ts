import 'reflect-metadata';
import { DependencyManager, globalContainer } from '@automoderator/core';
import { ProxyServer } from './server.js';

const _dependencyManager = globalContainer.get(DependencyManager);

const server = globalContainer.get(ProxyServer);
server.listen(8_000);
