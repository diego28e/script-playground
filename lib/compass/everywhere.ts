// Constructs on nearly every line of Python: too common to say what an error is about. An error is put down to the
// most specific construct on its line instead (lib/compass/signals.ts, the scratchbook's "About this error").
export const EVERYWHERE = new Set(["assignment", "string-literals", "numeric-literals", "print", "booleans", "none", "tuple-literal", "list-literal", "dict-literal"]);
