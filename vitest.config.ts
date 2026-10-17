import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		// The obsidian package ships types only, so tests run against a small double.
		alias: {
			obsidian: fileURLToPath(new URL('./test/obsidian-stub.ts', import.meta.url)),
		},
	},
	test: {
		include: ['test/**/*.test.ts'],
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
			include: ['src/**/*.ts'],
			// UI modules are covered by end-to-end tests (TASK-21), not unit thresholds.
			exclude: ['src/ui/**', 'src/main.ts'],
			reporter: ['text-summary', 'text', 'html'],
			thresholds: {
				lines: 75,
				'src/core/tags/**/*.ts': { lines: 95, branches: 90 },
				'src/core/resolve.ts': { lines: 95, branches: 90 },
				'src/core/output.ts': { lines: 95, branches: 90 },
				'src/core/inline.ts': { lines: 95, branches: 90 },
				'src/core/**/*.ts': { lines: 85, branches: 75 },
				'src/engines/**/*.ts': { lines: 85, branches: 75 },
			},
		},
	},
});
