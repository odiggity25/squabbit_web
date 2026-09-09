// The app's supported languages (must match functions/src/l10n/supportedLocales.js).
// Ad language targeting matches an ad's targetLanguages against each viewer's
// resolved app language. Listed alphabetically by display name for the picker.
export const LANGUAGES = [
    { code: 'nl', name: 'Dutch' },
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'nb', name: 'Norwegian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'es', name: 'Spanish' },
    { code: 'sv', name: 'Swedish' },
];

const CODE_TO_NAME = new Map(LANGUAGES.map((l) => [l.code, l.name]));

export function languageName(code) {
    return CODE_TO_NAME.get(code) || code;
}
