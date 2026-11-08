import { isLanguagePreference, type LanguagePreference } from '#lib/language.js';
import { InvalidInputError } from '#lib/domain/validation.js';
import { userPreferences } from './db/schema.js';
import { ensureUserSetUp } from './lists.js';
import { ownedBy, type UserScope } from './scope.js';

/** The User's chosen Language (CONTEXT.md → Language); Automatic until they choose one. */
export function getLanguagePreference(scope: UserScope): LanguagePreference {
	const row = scope.db
		.select({ value: userPreferences.languagePreference })
		.from(userPreferences)
		.where(ownedBy(userPreferences.userId, scope))
		.get();
	return isLanguagePreference(row?.value) ? row.value : 'automatic';
}

/** Stores the User's choice. Throws `InvalidInputError` for anything but Automatic or a Language. */
export function setLanguagePreference(scope: UserScope, value: unknown): LanguagePreference {
	if (!isLanguagePreference(value)) {
		throw new InvalidInputError('Language must be automatic or a Language we speak');
	}
	// The row is created together with the first List; make sure it exists before updating it.
	ensureUserSetUp(scope);
	scope.db
		.update(userPreferences)
		.set({ languagePreference: value })
		.where(ownedBy(userPreferences.userId, scope))
		.run();
	return value;
}
