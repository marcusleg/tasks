// Paraglide's compiler options, shared by the Vite plugin (vite.config.ts) and `npm run check`.

/** @type {import('@inlang/paraglide-js').ParaglideConfig} */
export default {
	outdir: './src/lib/paraglide',
	// The same layout from the Vite plugin and the CLI, so they never fight over the output.
	outputStructure: 'message-modules',
	emitTsDeclarations: true,
	// The Language is resolved per request on the server (src/lib/server/language.ts) and read back
	// from <html lang> in the browser (src/hooks.client.ts); Paraglide detects nothing itself.
	strategy: ['baseLocale']
};
