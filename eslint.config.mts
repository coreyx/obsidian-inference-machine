import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { builtinModules } from 'node:module';
import { globalIgnores, defineConfig } from 'eslint/config';

// REQ-17: the plugin runs on mobile, where Node built-ins don't exist.
const nodeBuiltins = {
	paths: builtinModules.map((name) => ({
		name,
		message: 'Node built-ins are unavailable on Obsidian mobile (REQ-17).',
	})),
	patterns: [
		{
			group: ['node:*'],
			message: 'Node built-ins are unavailable on Obsidian mobile (REQ-17).',
		},
	],
};

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'coverage',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Build and test tooling runs on Node, never inside Obsidian.
		files: ['*.mts', '*.ts', 'test/**/*.ts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	{
		// Vitest's asymmetric matchers (expect.any, objectContaining) are typed `any`.
		files: ['test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
		},
	},
	{
		files: ['src/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', nodeBuiltins],
		},
	},
	{
		// The pure core must stay testable without Obsidian (design.md).
		files: ['src/core/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						...nodeBuiltins.paths,
						{
							name: 'obsidian',
							message: 'src/core is pure: pass Obsidian data in from src/obsidian adapters.',
						},
					],
					patterns: nodeBuiltins.patterns,
				},
			],
		},
	},
);
