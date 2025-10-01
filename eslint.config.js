import common from 'eslint-config-neon/common';
import edge from 'eslint-config-neon/edge';
import jsxa11y from 'eslint-config-neon/jsx-a11y';
import next from 'eslint-config-neon/next';
import node from 'eslint-config-neon/node';
import prettier from 'eslint-config-neon/prettier';
import react from 'eslint-config-neon/react';
import typescript from 'eslint-config-neon/typescript';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import reactCompiler from 'eslint-plugin-react-compiler';
import merge from 'lodash.merge';
import tseslint from 'typescript-eslint';

const commonFiles = '{js,mjs,cjs,ts,mts,cts,jsx,tsx}';

const commonRuleset = merge(...common, { files: [`**/*${commonFiles}`] });

const nodeRuleset = merge(...node, { files: [`**/*${commonFiles}`] });

const typeScriptRuleset = merge(...typescript, {
	files: [`**/*${commonFiles}`],
	languageOptions: {
		parserOptions: {
			warnOnUnsupportedTypeScriptVersion: false,
			allowAutomaticSingleRunInference: true,
			project: ['tsconfig.eslint.json', 'apps/*/tsconfig.eslint.json', 'packages/*/tsconfig.eslint.json'],
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
		'id-length': [0],
	},
	settings: {
		'import-x/resolver-next': [
			createTypeScriptImportResolver({
				noWarnOnMultipleProjects: true,
				project: ['tsconfig.eslint.json', 'apps/*/tsconfig.eslint.json', 'packages/*/tsconfig.eslint.json'],
			}),
		],
	},
});

const reactRuleset = merge(...react, {
	files: [`apps/**/*${commonFiles}`],
	plugins: {
		'react-compiler': reactCompiler,
	},
	rules: {
		'react/jsx-handler-names': 0,
		'react-refresh/only-export-components': [0, { allowConstantExport: true }],
		'react-compiler/react-compiler': 2,
		'jsdoc/no-bad-blocks': 0,
		'tsdoc/syntax': 0,
		'@typescript-eslint/unbound-method': 0,
	},
});

const jsxa11yRuleset = merge(...jsxa11y, { files: [`apps/**/*${commonFiles}`] });

const nextRuleset = merge(...next, { files: [`apps/**/*${commonFiles}`] });

const edgeRuleset = merge(...edge, { files: [`apps/**/*${commonFiles}`] });

const prettierRuleset = merge(...prettier, { files: [`**/*${commonFiles}`] });

export default tseslint.config(
	{
		ignores: [
			'**/node_modules/',
			'.git/',
			'**/dist/',
			'**/template/',
			'**/coverage/',
			'**/storybook-static/',
			'**/.next/',
			'**/shiki.bundle.ts',
			'packages/private/core/src/types/entities.ts',
		],
	},
	commonRuleset,
	nodeRuleset,
	typeScriptRuleset,
	reactRuleset,
	jsxa11yRuleset,
	nextRuleset,
	edgeRuleset,
	{
		files: ['**/*{js,mjs,cjs,jsx}'],
		rules: { 'tsdoc/syntax': 0 },
	},
	prettierRuleset,
);
