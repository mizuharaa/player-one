// config.ts reads the legacy names by bracket access.
// Expo exposes only static EXPO_PUBLIC_ reads to the app bundle.
process.env.PLAYERONE_API_URL = process.env.EXPO_PUBLIC_API_URL ?? process.env.PLAYERONE_API_URL;
process.env.PLAYERONE_MOCK_API = process.env.EXPO_PUBLIC_MOCK_API ?? process.env.PLAYERONE_MOCK_API;
process.env.LANDING_CENTRE_CODE = process.env.EXPO_PUBLIC_CENTRE_CODE ?? process.env.LANDING_CENTRE_CODE;
