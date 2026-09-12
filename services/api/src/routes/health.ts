import { defineRoute } from '../core/route.js';

export default defineRoute({
	method: 'get',
	path: '/health',
	async handler(_req, res) {
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify({ status: 'ok' }));
	},
});
