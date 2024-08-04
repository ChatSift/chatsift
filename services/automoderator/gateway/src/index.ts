import 'reflect-metadata';
import { createServer } from 'node:http';
import { globalContainer, DependencyManager, setupCrashLogs, credentialsForCurrentBot } from '@automoderator/core';
import { Gateway } from './gateway.js';

const dependencyManager = globalContainer.get(DependencyManager);
dependencyManager.registerLogger('gateway');
dependencyManager.registerRedis();
dependencyManager.registerApi();

setupCrashLogs();

const gateway = globalContainer.get(Gateway);
await gateway.connect();

const server = createServer(async (req, res) => {
	if (req.url === '/guilds') {
		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');

		return res.end(JSON.stringify({ guilds: [...gateway.guildsIds] }));
	}

	res.statusCode = 404;
	res.end();
});

const credentials = credentialsForCurrentBot();
server.listen(new URL(credentials.gatewayURL).port);
