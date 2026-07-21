const { recase } = require('@kristiandupont/recase');

const toCamel = recase('snake', 'camel');

/** @type {import('kanel').Config} */
module.exports = {
	connection: {
		connectionString: process.env.DATABASE_URL,
	},

	schemas: ['public'],
	outputPath: './src/generated',
	preDeleteOutputFolder: true,

	// Row properties are camelCased to match the `postgres.camel` transform used at runtime
	// by `createDb()` (see docs/roadmap/02-foundation.md Part A step 2) — the DB stays
	// snake_case, but both the generated types and the actual query results are camelCase.
	//
	// kanel's CLI does `require(configPath)` — if this file were ESM (.js under this package's
	// "type": "module"), require() would return { default: <config> } unwrapped, silently
	// dropping every option below (including `connection`, so it'd fall back to a bare `pg`
	// default connection instead of erroring). Must stay .cjs.
	getPropertyMetadata: (property, _details, _generateFor, builtinMetadata) => ({
		...builtinMetadata,
		name: toCamel(property.name),
	}),
};
