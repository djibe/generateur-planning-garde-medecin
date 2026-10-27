import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		testTimeout: 120_000
	},
	build: {
		chunkSizeWarningLimit: 1600
	},
	css: {
    preprocessorOptions: {
      scss: {
        // Bootstrap's own SCSS emits Dart Sass deprecation warnings on
        // newer Sass versions — silence noise from third-party deps only.
        quietDeps: true
      }
    }
	}
});
