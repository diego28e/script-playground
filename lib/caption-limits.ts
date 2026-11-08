// Shared by the admin page and the server: how many caption lines one translation request takes. A batch Sonnet
// translates in well under a request's time (Amplify stops a request after about 30 s).
export const TRANSLATION_BATCH = 24;
