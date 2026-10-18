import obsidianmd from 'eslint-plugin-obsidianmd';
import { DEFAULT_BRANDS } from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js';
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
		'demo/vault/**/*.js',
		'.obsidian-cache',
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
					allowDefaultProject: ['eslint.config.mts', 'wdio.conf.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// Build and test tooling runs on Node, never inside Obsidian.
		files: ['*.mts', '*.ts', 'test/**/*.ts', 'test/**/*.mjs'],
		languageOptions: {
			globals: { ...globals.node },
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	{
		// Vitest's asymmetric matchers (expect.any, objectContaining) are typed `any`,
		// and tests run in Node, where there's no window for popout-safe timers. Test
		// tooling such as the mock server may report to the console.
		files: ['test/**/*.ts', 'test/**/*.mjs'],
		rules: {
			'no-console': 'off',
			'obsidianmd/rule-custom-message': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
	{
		// End-to-end specs run under Mocha in WebdriverIO. TypeScript checks names
		// there, so no-undef only misreads type-only globals such as WebdriverIO.
		files: ['test/e2e/**/*.ts', 'wdio.conf.mts'],
		languageOptions: {
			globals: { ...globals.mocha },
		},
		rules: {
			'no-undef': 'off',
		},
	},
	{
		files: ['src/**/*.ts'],
		rules: {
			'no-restricted-imports': ['error', nodeBuiltins],
			// Product names the plugin's UI mentions, kept in their official casing.
			'obsidianmd/ui/sentence-case': [
				'warn',
				{
					enforceCamelCaseLower: true,
					brands: [...DEFAULT_BRANDS, 'LM Studio', 'Inference Machine', 'Web Clipper', 'Spaced Repetition'],
				},
			],
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
