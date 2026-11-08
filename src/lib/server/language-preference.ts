import { isLanguagePreference, type Language, type LanguagePreference } from '#lib/language.js';
import { InvalidInputError } from '#lib/domain/validation.js';
import { userPreferences } from './db/schema.js';
import { ensureUserSetUp } from './lists.js';
import { ownedBy, type UserScope } from './scope.js';

/** Stores the User's choice. Throws `InvalidInputError` for anything but Automatic or a Language. */
export function setLanguagePreference(
	scope: UserScope,
	value: unknown,
	/** The request's Language: names the first List if this also sets the User up. */
	requestLanguage: Language
): LanguagePreference {
	if (!isLanguagePreference(value)) {
		throw new InvalidInputError('Language must be automatic or a Language we speak');
	}
	// The row is created together with the first List; make sure it exists before updating it.
	ensureUserSetUp(scope, requestLanguage);
	scope.db
		.update(userPreferences)
		.set({ languagePreference: value })
		.where(ownedBy(userPreferences.userId, scope))
		.run();
	return value;
}
