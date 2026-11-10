// How long one server request may work. Amplify stops a request at 28 s ("Request timed out - your application took
// too long to respond", Duration: 28001 ms, seen in production on 2026-11-10 while bulk-writing practice tasks): a
// request that runs past it is killed and the browser gets an error instead of an answer. Work that calls models or
// the grader ends by this budget, leaving room for the database writes and the response.
export const REQUEST_BUDGET_MS = 24_000;
