import common from 'eslint-config-neon/flat/common.js';
import next from 'eslint-config-neon/flat/next.js';
import node from 'eslint-config-neon/flat/node.js';
import prettier from 'eslint-config-neon/flat/prettier.js';
import react from 'eslint-config-neon/flat/react.js';
import typescript from 'eslint-config-neon/flat/typescript.js';
import merge from 'lodash.merge';
import tseslint from 'typescript-eslint';

const commonFiles = '{js,mjs,cjs,ts,mts,cts,jsx,tsx}';

const commonRuleset = merge(...common, {
	files: [`**/*${commonFiles}`],
	rules: {
		'no-eq-null': ['off'],
		eqeqeq: ['error', 'always', { null: 'ignore' }],
		'jsdoc/no-undefined-types': ['off'],
		'import/no-duplicates': ['off'],
	},
});

const nodeRuleset = merge(...node, { files: [`**/*${commonFiles}`] });

const typeScriptRuleset = merge(...typescript, {
	files: [`**/*${commonFiles}`],
	languageOptions: {
		parserOptions: {
			warnOnUnsupportedTypeScriptVersion: false,
			allowAutomaticSingleRunInference: true,
			project: ['tsconfig.eslint.json', 'services/*/tsconfig.eslint.json', 'packages/*/tsconfig.eslint.json'],
		},
	},
	rules: {
		'@typescript-eslint/consistent-type-definitions': [2, 'interface'],
		'@typescript-eslint/naming-convention': [
			2,
			{
				selector: 'typeParameter',
				format: ['PascalCase'],
				custom: {
					regex: '^\\w{3,}',
					match: true,
				},
			},
		],
	},
	settings: {
		'import/resolver': {
			typescript: {
				project: ['tsconfig.eslint.json', 'services/*/tsconfig.eslint.json', 'packages/*/tsconfig.eslint.json'],
			},
		},
	},
});

const reactRuleset = merge(...react, {
	files: [`apps/**/*${commonFiles}`, `packages/ui/**/*${commonFiles}`],
	rules: {
		'@next/next/no-html-link-for-pages': 0,
		'react/react-in-jsx-scope': 0,
		'react/jsx-filename-extension': [1, { extensions: ['.tsx'] }],
	},
});

const nextRuleset = merge(...next, { files: [`apps/**/*${commonFiles}`] });

const prettierRuleset = merge(...prettier, { files: [`**/*${commonFiles}`] });

export default tseslint.config(
	{
		ignores: ['**/node_modules/', '.git/', '**/dist/', '**/coverage/', 'packages/core/src/db.ts'],
	},
	commonRuleset,
	nodeRuleset,
	typeScriptRuleset,
	reactRuleset,
	nextRuleset,
	{
		files: [`apps/website/**/*${commonFiles}`],
		rules: {
			'no-restricted-globals': ['off'],
			'n/prefer-global/url': ['off'],
		},
	},
	prettierRuleset,
);
