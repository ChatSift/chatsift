/** @type {import('kanel').Config} */
export default {
	connection: {
		connectionString: process.env.DATABASE_URL,
	},

	schemas: ['public'],
	outputPath: './src/generated',
	preDeleteOutputFolder: true,
};
