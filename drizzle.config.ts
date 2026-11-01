import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	// Only used by `db:studio`; migrations are applied by the app at startup.
	dbCredentials: { url: process.env.DATABASE_PATH ?? './data/tasks.db' },
	verbose: true,
	strict: true
});
