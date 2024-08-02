// Simple server to let other parts of the stack know what guilds this bot has

import { createServer } from 'node:http';

export const server = createServer(async (req, res) => {
	if (req.url === '/guilds') {
		res.statusCode = 200;
		res.setHeader('Content-Type', 'application/json');

		res.end(JSON.stringify({ guilds: ['guild1', 'guild2'] }));
	}
});
