import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_PATH: {
		description:
			'Path to the SQLite database file. Defaults to ./data/tasks.db in dev and /data/tasks.db otherwise.',
		schema: (value) => value || undefined
	}
});
