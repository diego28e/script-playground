import ts from "typescript";

// The JavaScript Compass's detector (docs/compass.md, "JavaScript"): names the JavaScript and TypeScript constructs in
// a piece of code and the lines they're on, as lib/compass/detector.py does for Python. It parses with TypeScript's
// compiler API (the platform's own TypeScript 5: TypeScript 7, the course's compiler, has no stable JavaScript API yet),
// which only reads the code: nothing runs. Built from the course audit's inventory script (js-inventory.mjs).
//
// A concept's key is stable: the course inventory, the tables and learners' signals are keyed on it. Three kinds:
// syntax (a fixed list, below), built-ins seen by name (a global's member, an instance method, a class built with `new`,
// a global function, a `node:` module: keys made from the name), and TypeScript's type syntax.

export type Concept = { key: string; group: string; label: string; labelEs: string };

const C = (group: string, label: string, labelEs: string) => ({ group, label, labelEs });

/** The syntax the detector knows, by key: group, then the English and Spanish labels. */
export const SYNTAX: Record<string, { group: string; label: string; labelEs: string }> = {
  // Variables and values
  const: C("variables", "const", "const"),
  let: C("variables", "let", "let"),
  var: C("variables", "var (the old way)", "var (la forma antigua)"),
  "template-literal": C("strings", "Template literals with ${}", "Template literals con ${}"),
  "tagged-template": C("strings", "Tagged templates", "Tagged templates"),
  "numeric-separator": C("numbers", "Numeric separators (1_000)", "Separadores numéricos (1_000)"),
  "bigint-literal": C("numbers", "BigInt literals (10n)", "Literales BigInt (10n)"),
  // Operators
  "strict-equality": C("operators", "Strict equality === and !==", "Igualdad estricta === y !=="),
  "loose-equality": C("operators", "Loose equality == and !=", "Igualdad laxa == y !="),
  comparison: C("operators", "Comparisons < > <= >=", "Comparaciones < > <= >="),
  "logical-and": C("operators", "The && operator", "El operador &&"),
  "logical-or": C("operators", "The || operator", "El operador ||"),
  "logical-not": C("operators", "The ! operator", "El operador !"),
  "double-negation": C("operators", "Double negation !!", "Doble negación !!"),
  "nullish-coalescing": C("operators", "Nullish coalescing ??", "Coalescencia nula ??"),
  "logical-assignment": C("operators", "Logical assignment ??= ||= &&=", "Asignación lógica ??= ||= &&="),
  "compound-assignment": C("operators", "Compound assignment += -= *=", "Asignación compuesta += -= *="),
  exponent: C("operators", "Exponent **", "Potencia **"),
  remainder: C("operators", "Remainder %", "Resto %"),
  "increment-decrement": C("operators", "++ and --", "++ y --"),
  ternary: C("operators", "The conditional operator ? :", "El operador condicional ? :"),
  "typeof-operator": C("operators", "typeof on a value", "typeof sobre un valor"),
  "instanceof-operator": C("operators", "instanceof", "instanceof"),
  "in-operator": C("operators", "The in operator", "El operador in"),
  "delete-operator": C("operators", "delete", "delete"),
  "void-operator": C("operators", "void", "void"),
  "comma-operator": C("operators", "The comma operator", "El operador coma"),
  "bitwise-operator": C("operators", "Bitwise operators", "Operadores bit a bit"),
  "optional-chaining": C("operators", "Optional chaining ?.", "Encadenamiento opcional ?."),
  // Control flow
  if: C("control-flow", "if", "if"),
  else: C("control-flow", "else", "else"),
  "else-if": C("control-flow", "else if", "else if"),
  switch: C("control-flow", "switch", "switch"),
  "switch-default": C("control-flow", "default in a switch", "default en un switch"),
  "break-switch": C("control-flow", "break in a switch", "break en un switch"),
  "break-loop": C("control-flow", "break in a loop", "break en un bucle"),
  continue: C("control-flow", "continue", "continue"),
  label: C("control-flow", "Labelled statements", "Sentencias con etiqueta"),
  "for-loop": C("control-flow", "for (counting loops)", "for (bucles con contador)"),
  "for-of": C("control-flow", "for...of", "for...of"),
  "for-in": C("control-flow", "for...in", "for...in"),
  "for-await-of": C("async", "for await...of", "for await...of"),
  while: C("control-flow", "while", "while"),
  "do-while": C("control-flow", "do...while", "do...while"),
  "bare-return": C("functions", "return with no value", "return sin valor"),
  // Functions
  "function-declaration": C("functions", "Function declarations", "Declaraciones de funciones"),
  "function-expression": C("functions", "Function expressions", "Expresiones de función"),
  "arrow-function": C("functions", "Arrow functions", "Funciones flecha"),
  "default-parameter": C("functions", "Default parameters", "Parámetros por defecto"),
  "rest-parameter": C("functions", "Rest parameters ...args", "Parámetros rest ...args"),
  "function-returning-function": C("functions", "Functions that return functions", "Funciones que devuelven funciones"),
  recursion: C("functions", "Recursion", "Recursión"),
  iife: C("functions", "Immediately invoked functions", "Funciones invocadas al instante"),
  "generator-function": C("functions", "Generator functions", "Funciones generadoras"),
  yield: C("functions", "yield", "yield"),
  // Objects
  "object-destructuring": C("objects", "Object destructuring", "Desestructuración de objetos"),
  "destructuring-default": C("objects", "Defaults in destructuring", "Valores por defecto al desestructurar"),
  "destructuring-rename": C("objects", "Renaming in destructuring", "Renombrar al desestructurar"),
  "destructured-parameter": C("objects", "Destructured parameters", "Parámetros desestructurados"),
  "destructured-parameter-default": C("objects", "Destructured parameters with = {}", "Parámetros desestructurados con = {}"),
  "rest-destructuring": C("objects", "Rest in destructuring", "Rest al desestructurar"),
  "object-spread": C("objects", "Object spread { ...a }", "Spread de objetos { ...a }"),
  "shorthand-property": C("objects", "Shorthand properties", "Propiedades abreviadas"),
  "method-shorthand": C("objects", "Methods in object literals", "Métodos en literales de objeto"),
  "computed-property": C("objects", "Computed property names [key]:", "Nombres de propiedad calculados [key]:"),
  "bracket-access": C("objects", "Bracket access [ ]", "Acceso con corchetes [ ]"),
  // Arrays
  "array-destructuring": C("arrays", "Array destructuring", "Desestructuración de arrays"),
  "array-destructuring-hole": C("arrays", "Skipping items when destructuring", "Saltar elementos al desestructurar"),
  "array-spread": C("arrays", "Array spread [...a]", "Spread de arrays [...a]"),
  "spread-call": C("arrays", "Spreading into a call f(...args)", "Spread en una llamada f(...args)"),
  length: C("arrays", ".length", ".length"),
  size: C("built-ins", ".size of a Map or Set", ".size de un Map o Set"),
  // Classes
  class: C("classes", "Classes", "Clases"),
  "class-extends": C("classes", "extends", "extends"),
  constructor: C("classes", "constructor", "constructor"),
  "private-member": C("classes", "#private members", "Miembros #privados"),
  "static-member": C("classes", "static members", "Miembros static"),
  getter: C("classes", "Getters", "Getters"),
  setter: C("classes", "Setters", "Setters"),
  "static-block": C("classes", "Static blocks", "Bloques static"),
  "class-field": C("classes", "Class fields with a value", "Campos de clase con valor"),
  "arrow-class-field": C("classes", "Arrow functions in class fields", "Funciones flecha en campos de clase"),
  "super-call": C("classes", "super(...)", "super(...)"),
  "super-method": C("classes", "super.method()", "super.method()"),
  this: C("classes", "this", "this"),
  "new-own-class": C("classes", "new with your own classes", "new con tus propias clases"),
  // Errors
  throw: C("errors", "throw", "throw"),
  "try-catch": C("errors", "try / catch", "try / catch"),
  finally: C("errors", "finally", "finally"),
  "catch-without-variable": C("errors", "catch without a variable", "catch sin variable"),
  // Async
  await: C("async", "await", "await"),
  "top-level-await": C("async", "Top-level await", "await en el nivel superior"),
  "async-function": C("async", "async functions", "Funciones async"),
  "async-arrow": C("async", "async arrow functions", "Funciones flecha async"),
  // Regular expressions
  "regex-literal": C("regex", "Regular expression literals", "Literales de expresiones regulares"),
  "regex-global": C("regex", "The g flag", "La bandera g"),
  "regex-capture-group": C("regex", "Capture groups", "Grupos de captura"),
  // Modules
  import: C("modules", "import", "import"),
  "default-import": C("modules", "Default imports", "Imports por defecto"),
  "namespace-import": C("modules", "import * as", "import * as"),
  "import-rename": C("modules", "Renaming imports { a as b }", "Renombrar imports { a as b }"),
  "side-effect-import": C("modules", "Side-effect imports", "Imports por efecto secundario"),
  "default-and-named-import": C("modules", "Default and named imports together", "Import por defecto y con nombre juntos"),
  "dynamic-import": C("modules", "Dynamic import()", "import() dinámico"),
  "import-meta": C("modules", "import.meta", "import.meta"),
  "export-list": C("modules", "export { … }", "export { … }"),
  "re-export": C("modules", "Re-exports export … from", "Re-exportar export … from"),
  "export-default": C("modules", "export default", "export default"),
  "import-type": C("types", "import type", "import type"),
  "inline-type-import": C("types", "Inline type imports { type X }", "Imports de tipo en línea { type X }"),
  "export-type": C("types", "export type { … }", "export type { … }"),
  // TypeScript's type syntax
  "type-annotation": C("types", "Type annotations", "Anotaciones de tipo"),
  "return-type": C("types", "Return type annotations", "Anotación del tipo de retorno"),
  "type-alias": C("types", "Type aliases (type)", "Alias de tipo (type)"),
  interface: C("types", "Interfaces", "Interfaces"),
  "interface-extends": C("types", "Interfaces that extend", "Interfaces que extienden"),
  "union-type": C("types", "Union types A | B", "Tipos unión A | B"),
  "intersection-type": C("types", "Intersection types A & B", "Tipos intersección A & B"),
  "literal-type": C("types", "Literal types", "Tipos literales"),
  "array-type": C("types", "Array types T[]", "Tipos array T[]"),
  "tuple-type": C("types", "Tuples", "Tuplas"),
  "optional-property": C("types", "Optional properties and parameters ?", "Propiedades y parámetros opcionales ?"),
  "readonly-modifier": C("types", "readonly", "readonly"),
  "index-signature": C("types", "Index signatures", "Firmas de índice"),
  "function-type": C("types", "Function types", "Tipos de función"),
  "generic-function": C("types", "Generic functions <T>", "Funciones genéricas <T>"),
  "generic-type": C("types", "Generic types and interfaces", "Tipos e interfaces genéricos"),
  "generic-class": C("types", "Generic classes", "Clases genéricas"),
  "generic-constraint": C("types", "Constraints T extends …", "Restricciones T extends …"),
  "generic-default": C("types", "Default type parameters", "Parámetros de tipo por defecto"),
  "const-type-parameter": C("types", "const type parameters", "Parámetros de tipo const"),
  "type-arguments": C("types", "Explicit type arguments f<T>()", "Argumentos de tipo explícitos f<T>()"),
  "keyof-type": C("types", "keyof", "keyof"),
  "typeof-type": C("types", "typeof in a type", "typeof en un tipo"),
  "indexed-access-type": C("types", "Indexed access types T[\"key\"]", "Tipos de acceso indexado T[\"key\"]"),
  "mapped-type": C("types", "Mapped types", "Tipos mapeados"),
  "conditional-type": C("types", "Conditional types", "Tipos condicionales"),
  "infer-type": C("types", "infer", "infer"),
  "template-literal-type": C("types", "Template literal types", "Tipos template literal"),
  satisfies: C("types", "satisfies", "satisfies"),
  "as-assertion": C("types", "Type assertions with as", "Aserciones de tipo con as"),
  "as-const": C("types", "as const", "as const"),
  "non-null-assertion": C("types", "Non-null assertions !", "Aserciones no nulas !"),
  "type-predicate": C("types", "Type predicates x is T", "Predicados de tipo x is T"),
  "assertion-function": C("types", "Assertion functions asserts", "Funciones de aserción asserts"),
  "any-type": C("types", "any", "any"),
  "unknown-type": C("types", "unknown", "unknown"),
  "never-type": C("types", "never", "never"),
  "void-type": C("types", "void", "void"),
  overloads: C("types", "Function overloads", "Sobrecargas de funciones"),
  "this-parameter": C("types", "this parameters", "Parámetros this"),
  implements: C("types", "implements", "implements"),
  "access-modifier": C("types", "public, private and protected", "public, private y protected"),
  "abstract-class": C("types", "Abstract classes", "Clases abstractas"),
  "parameter-property": C("types", "Parameter properties", "Propiedades en parámetros"),
  enum: C("types", "enum", "enum"),
  namespace: C("types", "namespace and declare module", "namespace y declare module"),
  declare: C("types", "declare", "declare"),
  "ts-expect-error": C("types", "// @ts-expect-error", "// @ts-expect-error"),
  "export-equals": C("types", "export =", "export ="),
};

// Built-ins seen by name. A global's member (`Math.round`), an instance method (`.map()`), a class built with `new`, a
// global function, a `node:` module: each gets a key from its name, so a new one needs no change here.
const GLOBAL_OBJECTS = new Set(["Object", "Array", "Number", "Math", "JSON", "Promise", "Date", "String", "Symbol", "BigInt", "Reflect", "AbortSignal", "Error", "URL", "Buffer", "process", "console", "performance", "crypto", "Intl", "assert"]);
const STRING_METHODS = ["split", "slice", "substring", "indexOf", "lastIndexOf", "startsWith", "endsWith", "replace", "replaceAll", "padStart", "padEnd", "trim", "trimStart", "trimEnd", "toUpperCase", "toLowerCase", "repeat", "charAt", "charCodeAt", "localeCompare", "match", "matchAll", "normalize", "codePointAt", "toFixed", "toLocaleString", "toISOString", "toString"];
const ARRAY_METHODS = ["map", "filter", "reduce", "reduceRight", "find", "findIndex", "findLast", "some", "every", "forEach", "push", "pop", "shift", "unshift", "splice", "concat", "flat", "flatMap", "sort", "toSorted", "reverse", "toReversed", "toSpliced", "with", "includes", "join", "entries", "keys", "values", "fill", "at"];
const METHOD_GROUP: Record<string, string> = Object.fromEntries([
  ...STRING_METHODS.map((name) => [name, "strings"]),
  ...ARRAY_METHODS.map((name) => [name, "arrays"]),
  ...["get", "set", "has", "delete", "clear", "add"].map((name) => [name, "built-ins"]),
  ...["test", "exec"].map((name) => [name, "regex"]),
  ...["getTime", "getUTCFullYear", "getUTCMonth", "getUTCDate", "getFullYear", "getMonth", "getDate", "setUTCFullYear", "toDateString"].map((name) => [name, "dates"]),
  ...["then", "catch", "finally"].map((name) => [name, "async"]),
  ...["call", "apply", "bind"].map((name) => [name, "functions"]),
]);
const NEW_CLASSES = new Set(["Map", "Set", "WeakMap", "WeakSet", "Date", "Promise", "URL", "URLSearchParams", "Error", "TypeError", "RangeError", "SyntaxError", "AbortController", "Proxy", "Array", "Response", "Headers", "Socket", "IncomingMessage", "DOMException", "AggregateError"]);
const GLOBAL_FUNCTIONS = new Set(["structuredClone", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask", "fetch", "parseInt", "parseFloat", "isNaN", "Number", "String", "Boolean", "BigInt", "Symbol", "require"]);
// TypeScript's utility types, by name.
const UTILITY_TYPES = new Set(["Partial", "Required", "Readonly", "Pick", "Omit", "Record", "Exclude", "Extract", "NonNullable", "ReturnType", "Parameters", "Awaited", "InstanceType", "ConstructorParameters", "NoInfer", "ReadonlyArray", "Uppercase", "Lowercase", "Capitalize", "Uncapitalize"]);
const GROUP_OF_OBJECT: Record<string, string> = { Math: "numbers", Number: "numbers", JSON: "built-ins", Object: "objects", Array: "arrays", Promise: "async", Date: "dates", String: "strings", process: "node", console: "built-ins", assert: "node", AbortSignal: "async", performance: "node", crypto: "node", Buffer: "node" };

/** The concept a key names: from the syntax list, or rebuilt from a built-in's key. Null for a key the detector never makes. */
export function conceptOf(key: string): Concept | null {
  const known = SYNTAX[key];
  if (known) return { key, ...known };
  const [family, ...rest] = key.split(":");
  const name = rest.join(":");
  if (!name) return null;
  switch (family) {
    case "member": {
      const [object] = name.split(".");
      return { key, group: GROUP_OF_OBJECT[object] ?? "built-ins", label: name, labelEs: name };
    }
    case "method":
      return { key, group: METHOD_GROUP[name] ?? "built-ins", label: `.${name}()`, labelEs: `.${name}()` };
    case "new":
      return { key, group: /Error|Exception$/.test(name) ? "errors" : name === "Promise" ? "async" : "built-ins", label: `new ${name}`, labelEs: `new ${name}` };
    case "call":
      return { key, group: "built-ins", label: `${name}()`, labelEs: `${name}()` };
    case "node":
      return { key, group: "node", label: `node:${name}`, labelEs: `node:${name}` };
    case "utility":
      return { key, group: "types", label: `${name}<T>`, labelEs: `${name}<T>` };
    default:
      return null;
  }
}

const KEYWORD_TYPES: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.AnyKeyword]: "any-type",
  [ts.SyntaxKind.UnknownKeyword]: "unknown-type",
  [ts.SyntaxKind.NeverKeyword]: "never-type",
  [ts.SyntaxKind.VoidKeyword]: "void-type",
};

const BINARY: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.AmpersandAmpersandToken]: "logical-and",
  [ts.SyntaxKind.BarBarToken]: "logical-or",
  [ts.SyntaxKind.QuestionQuestionToken]: "nullish-coalescing",
  [ts.SyntaxKind.QuestionQuestionEqualsToken]: "logical-assignment",
  [ts.SyntaxKind.BarBarEqualsToken]: "logical-assignment",
  [ts.SyntaxKind.AmpersandAmpersandEqualsToken]: "logical-assignment",
  [ts.SyntaxKind.AsteriskAsteriskToken]: "exponent",
  [ts.SyntaxKind.PercentToken]: "remainder",
  [ts.SyntaxKind.EqualsEqualsToken]: "loose-equality",
  [ts.SyntaxKind.ExclamationEqualsToken]: "loose-equality",
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "strict-equality",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "strict-equality",
  [ts.SyntaxKind.LessThanToken]: "comparison",
  [ts.SyntaxKind.GreaterThanToken]: "comparison",
  [ts.SyntaxKind.LessThanEqualsToken]: "comparison",
  [ts.SyntaxKind.GreaterThanEqualsToken]: "comparison",
  [ts.SyntaxKind.InstanceOfKeyword]: "instanceof-operator",
  [ts.SyntaxKind.InKeyword]: "in-operator",
  [ts.SyntaxKind.CommaToken]: "comma-operator",
  [ts.SyntaxKind.PlusEqualsToken]: "compound-assignment",
  [ts.SyntaxKind.MinusEqualsToken]: "compound-assignment",
  [ts.SyntaxKind.AsteriskEqualsToken]: "compound-assignment",
  [ts.SyntaxKind.SlashEqualsToken]: "compound-assignment",
  [ts.SyntaxKind.AmpersandToken]: "bitwise-operator",
  [ts.SyntaxKind.BarToken]: "bitwise-operator",
  [ts.SyntaxKind.CaretToken]: "bitwise-operator",
  [ts.SyntaxKind.LessThanLessThanToken]: "bitwise-operator",
  [ts.SyntaxKind.GreaterThanGreaterThanToken]: "bitwise-operator",
};

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));

/** Whether a `|` or `&` reads as a type written alone ("paid" | "failed") rather than a bitwise operation on numbers. */
function looksLikeTypes(node: ts.BinaryExpression): boolean {
  const typeLike = (side: ts.Expression): boolean =>
    ts.isStringLiteral(side) ||
    ts.isNoSubstitutionTemplateLiteral(side) ||
    (ts.isIdentifier(side) && /^[A-Z]/.test(side.text)) ||
    side.kind === ts.SyntaxKind.NullKeyword ||
    side.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isBinaryExpression(side) && (side.operatorToken.kind === ts.SyntaxKind.BarToken || side.operatorToken.kind === ts.SyntaxKind.AmpersandToken) && looksLikeTypes(side));
  return typeLike(node.left) || typeLike(node.right);
}

/**
 * The constructs in `code`, each with the lines (1-based, sorted) it's on. `typescript: false` reads it as JavaScript.
 * Code that doesn't parse cleanly is read as far as it goes: the parser recovers, as an editor does.
 */
export function detect(code: string, { typescript = true }: { typescript?: boolean } = {}): Record<string, number[]> {
  const found = new Map<string, Set<number>>();
  const source = ts.createSourceFile(typescript ? "code.ts" : "code.js", code, ts.ScriptTarget.Latest, true, typescript ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const add = (key: string, node: ts.Node) => {
    if (!found.has(key)) found.set(key, new Set());
    found.get(key)!.add(lineOf(node));
  };

  // Directive comments are comments, not nodes.
  code.split("\n").forEach((line, index) => {
    if (/\/\/\s*@ts-(expect-error|ignore)\b/.test(line)) {
      if (!found.has("ts-expect-error")) found.set("ts-expect-error", new Set());
      found.get("ts-expect-error")!.add(index + 1);
    }
  });

  const enclosing = (node: ts.Node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isSwitchStatement(parent)) return "switch";
      if (ts.isIterationStatement(parent, false)) return "loop";
      if (ts.isFunctionLike(parent)) return "function";
    }
    return "top";
  };
  const isAsync = (node: ts.Node) => hasModifier(node, ts.SyntaxKind.AsyncKeyword);
  // Function declarations by name, to tell overloads (several signatures, one body).
  const declared = new Map<string, number>();

  const visit = (node: ts.Node): void => {
    // Type syntax: annotations wherever a declaration has a type written.
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) && node.type) add("type-annotation", node.type);
    if (ts.isParameter(node) && node.type && !(ts.isIdentifier(node.name) && node.name.text === "this")) add("type-annotation", node.type);
    if (ts.isFunctionLike(node) && node.type && !ts.isFunctionTypeNode(node)) add("return-type", node.type);
    if (ts.isFunctionLike(node) && node.typeParameters?.length && !ts.isFunctionTypeNode(node)) add("generic-function", node);

    switch (node.kind) {
      case ts.SyntaxKind.IfStatement: {
        const statement = node as ts.IfStatement;
        add("if", node);
        if (statement.elseStatement) add(ts.isIfStatement(statement.elseStatement) ? "else-if" : "else", statement.elseStatement);
        break;
      }
      case ts.SyntaxKind.SwitchStatement:
        add("switch", node);
        break;
      case ts.SyntaxKind.DefaultClause:
        add("switch-default", node);
        break;
      case ts.SyntaxKind.BreakStatement:
        add(enclosing(node) === "switch" ? "break-switch" : "break-loop", node);
        break;
      case ts.SyntaxKind.ContinueStatement:
        add("continue", node);
        break;
      case ts.SyntaxKind.ForStatement:
        add("for-loop", node);
        break;
      case ts.SyntaxKind.ForOfStatement:
        add((node as ts.ForOfStatement).awaitModifier ? "for-await-of" : "for-of", node);
        break;
      case ts.SyntaxKind.ForInStatement:
        add("for-in", node);
        break;
      case ts.SyntaxKind.WhileStatement:
        add("while", node);
        break;
      case ts.SyntaxKind.DoStatement:
        add("do-while", node);
        break;
      case ts.SyntaxKind.LabeledStatement:
        add("label", node);
        break;
      case ts.SyntaxKind.TryStatement: {
        const statement = node as ts.TryStatement;
        add("try-catch", node);
        if (statement.finallyBlock) add("finally", statement.finallyBlock);
        if (statement.catchClause && !statement.catchClause.variableDeclaration) add("catch-without-variable", statement.catchClause);
        break;
      }
      case ts.SyntaxKind.ThrowStatement:
        add("throw", node);
        break;
      case ts.SyntaxKind.ReturnStatement:
        if (!(node as ts.ReturnStatement).expression) add("bare-return", node);
        break;
      case ts.SyntaxKind.ConditionalExpression:
        add("ternary", node);
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const expression = node as ts.BinaryExpression;
        const key = BINARY[expression.operatorToken.kind];
        // `"paid" | "failed"` shown alone in a lesson parses as a bitwise or: it's a type, not an operation.
        if (key && !(key === "bitwise-operator" && looksLikeTypes(expression))) add(key, expression.operatorToken);
        break;
      }
      case ts.SyntaxKind.PrefixUnaryExpression: {
        const expression = node as ts.PrefixUnaryExpression;
        if (expression.operator === ts.SyntaxKind.ExclamationToken) {
          const double = ts.isPrefixUnaryExpression(expression.operand) && expression.operand.operator === ts.SyntaxKind.ExclamationToken;
          if (double) add("double-negation", node);
          else if (!(ts.isPrefixUnaryExpression(node.parent) && node.parent.operator === ts.SyntaxKind.ExclamationToken)) add("logical-not", node);
        }
        if (expression.operator === ts.SyntaxKind.PlusPlusToken || expression.operator === ts.SyntaxKind.MinusMinusToken) add("increment-decrement", node);
        break;
      }
      case ts.SyntaxKind.PostfixUnaryExpression:
        add("increment-decrement", node);
        break;
      case ts.SyntaxKind.TypeOfExpression:
        add("typeof-operator", node);
        break;
      case ts.SyntaxKind.VoidExpression: {
        // A lone `void` in a fragment (a return type shown alone) parses as `void` with nothing after it.
        const operand = (node as ts.VoidExpression).expression;
        if (!(ts.isIdentifier(operand) && !operand.text)) add("void-operator", node);
        break;
      }
      case ts.SyntaxKind.DeleteExpression:
        add("delete-operator", node);
        break;
      case ts.SyntaxKind.AwaitExpression:
        add("await", node);
        if (enclosing(node) === "top" || !findFunction(node)) add("top-level-await", node);
        break;
      case ts.SyntaxKind.SpreadElement:
        add(ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent) ? "spread-call" : "array-spread", node);
        break;
      case ts.SyntaxKind.SpreadAssignment:
        add("object-spread", node);
        break;
      case ts.SyntaxKind.ArrowFunction: {
        const arrow = node as ts.ArrowFunction;
        add("arrow-function", node);
        if (isAsync(node)) add("async-arrow", node);
        if (ts.isPropertyDeclaration(node.parent)) add("arrow-class-field", node);
        if (returnsFunction(arrow)) add("function-returning-function", node);
        break;
      }
      case ts.SyntaxKind.FunctionExpression:
        add("function-expression", node);
        if (isAsync(node)) add("async-function", node);
        break;
      case ts.SyntaxKind.FunctionDeclaration: {
        const declaration = node as ts.FunctionDeclaration;
        add("function-declaration", node);
        if (isAsync(node)) add("async-function", node);
        if (declaration.asteriskToken) add("generator-function", node);
        if (returnsFunction(declaration)) add("function-returning-function", node);
        if (declaration.name) {
          const name = declaration.name.text;
          declared.set(name, (declared.get(name) ?? 0) + 1);
          if (declared.get(name)! > 1 || !declaration.body) add("overloads", node);
          if (declaration.body && callsItself(declaration.body, name)) add("recursion", node);
        }
        break;
      }
      case ts.SyntaxKind.MethodDeclaration:
        if (ts.isObjectLiteralExpression(node.parent)) add("method-shorthand", node);
        if (isAsync(node)) add("async-function", node);
        if ((node as ts.MethodDeclaration).asteriskToken) add("generator-function", node);
        break;
      case ts.SyntaxKind.YieldExpression:
        add("yield", node);
        break;
      case ts.SyntaxKind.TemplateExpression:
        add("template-literal", node);
        break;
      case ts.SyntaxKind.TaggedTemplateExpression:
        add("tagged-template", node);
        break;
      case ts.SyntaxKind.RegularExpressionLiteral: {
        const text = (node as ts.RegularExpressionLiteral).text;
        add("regex-literal", node);
        if (/\/[a-z]*g[a-z]*$/.test(text)) add("regex-global", node);
        if (/\((?!\?)/.test(text.replace(/\\\(/g, ""))) add("regex-capture-group", node);
        break;
      }
      case ts.SyntaxKind.ComputedPropertyName:
        if (ts.isPropertyAssignment(node.parent) || ts.isMethodDeclaration(node.parent)) add("computed-property", node);
        break;
      case ts.SyntaxKind.ShorthandPropertyAssignment:
        add("shorthand-property", node);
        break;
      case ts.SyntaxKind.ObjectBindingPattern: {
        const pattern = node as ts.ObjectBindingPattern;
        add("object-destructuring", node);
        if (pattern.elements.some((element) => element.initializer)) add("destructuring-default", node);
        if (pattern.elements.some((element) => element.propertyName)) add("destructuring-rename", node);
        if (pattern.elements.some((element) => element.dotDotDotToken)) add("rest-destructuring", node);
        if (ts.isParameter(node.parent)) {
          add("destructured-parameter", node);
          if (node.parent.initializer) add("destructured-parameter-default", node);
        }
        break;
      }
      case ts.SyntaxKind.ArrayBindingPattern: {
        const pattern = node as ts.ArrayBindingPattern;
        add("array-destructuring", node);
        if (pattern.elements.some((element) => ts.isOmittedExpression(element))) add("array-destructuring-hole", node);
        if (pattern.elements.some((element) => !ts.isOmittedExpression(element) && element.dotDotDotToken)) add("rest-destructuring", node);
        break;
      }
      case ts.SyntaxKind.Parameter: {
        const parameter = node as ts.ParameterDeclaration;
        if (parameter.dotDotDotToken) add("rest-parameter", node);
        if (parameter.initializer && !ts.isObjectBindingPattern(parameter.name)) add("default-parameter", node);
        if (parameter.questionToken) add("optional-property", node);
        if (ts.isIdentifier(parameter.name) && parameter.name.text === "this") add("this-parameter", node);
        if (ts.isConstructorDeclaration(node.parent) && [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].some((kind) => hasModifier(node, kind))) add("parameter-property", node);
        break;
      }
      case ts.SyntaxKind.NumericLiteral:
        if (node.getText(source).includes("_")) add("numeric-separator", node);
        break;
      case ts.SyntaxKind.BigIntLiteral:
        add("bigint-literal", node);
        if (node.getText(source).includes("_")) add("numeric-separator", node);
        break;
      case ts.SyntaxKind.MetaProperty:
        if ((node as ts.MetaProperty).keywordToken === ts.SyntaxKind.ImportKeyword) add("import-meta", node);
        break;
      case ts.SyntaxKind.ClassDeclaration:
      case ts.SyntaxKind.ClassExpression: {
        const declaration = node as ts.ClassLikeDeclaration;
        add("class", node);
        if (declaration.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)) add("class-extends", node);
        if (declaration.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)) add("implements", node);
        if (declaration.typeParameters?.length) add("generic-class", node);
        if (hasModifier(node, ts.SyntaxKind.AbstractKeyword)) add("abstract-class", node);
        for (const member of declaration.members) {
          if (ts.isConstructorDeclaration(member)) add("constructor", member);
          if (member.name && ts.isPrivateIdentifier(member.name)) add("private-member", member);
          if (hasModifier(member, ts.SyntaxKind.StaticKeyword)) add("static-member", member);
          if (ts.isGetAccessor(member)) add("getter", member);
          if (ts.isSetAccessor(member)) add("setter", member);
          if (ts.isClassStaticBlockDeclaration(member)) add("static-block", member);
          if (ts.isPropertyDeclaration(member) && member.initializer) add("class-field", member);
          if ([ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].some((kind) => hasModifier(member, kind))) add("access-modifier", member);
          if (ts.isPropertyDeclaration(member) && (member.questionToken || hasModifier(member, ts.SyntaxKind.ReadonlyKeyword))) add(member.questionToken ? "optional-property" : "readonly-modifier", member);
        }
        break;
      }
      case ts.SyntaxKind.SuperKeyword:
        add(ts.isCallExpression(node.parent) ? "super-call" : "super-method", node);
        break;
      case ts.SyntaxKind.ThisKeyword:
        add("this", node);
        break;
      case ts.SyntaxKind.NewExpression: {
        const expression = node as ts.NewExpression;
        const name = ts.isIdentifier(expression.expression) ? expression.expression.text : null;
        add(name && NEW_CLASSES.has(name) ? `new:${name}` : "new-own-class", node);
        if (expression.typeArguments?.length) add("type-arguments", node);
        break;
      }
      case ts.SyntaxKind.PropertyAccessExpression: {
        const access = node as ts.PropertyAccessExpression;
        if (access.questionDotToken) add("optional-chaining", node);
        if (ts.isIdentifier(access.expression) && GLOBAL_OBJECTS.has(access.expression.text)) add(`member:${access.expression.text}.${access.name.text}`, node);
        if (access.name.text === "size" && !ts.isCallExpression(node.parent)) add("size", access.name);
        if (access.name.text === "length") add("length", access.name);
        break;
      }
      case ts.SyntaxKind.ElementAccessExpression:
        if ((node as ts.ElementAccessExpression).questionDotToken) add("optional-chaining", node);
        add("bracket-access", node);
        break;
      case ts.SyntaxKind.CallExpression: {
        const call = node as ts.CallExpression;
        const callee = call.expression;
        if (call.questionDotToken) add("optional-chaining", node);
        if (callee.kind === ts.SyntaxKind.ImportKeyword) add("dynamic-import", node);
        if (ts.isIdentifier(callee) && GLOBAL_FUNCTIONS.has(callee.text)) add(`call:${callee.text}`, node);
        if (ts.isPropertyAccessExpression(callee) && METHOD_GROUP[callee.name.text] && !(ts.isIdentifier(callee.expression) && GLOBAL_OBJECTS.has(callee.expression.text))) add(`method:${callee.name.text}`, callee.name);
        if (ts.isParenthesizedExpression(callee) && (ts.isFunctionExpression(callee.expression) || ts.isArrowFunction(callee.expression))) add("iife", node);
        if (call.typeArguments?.length) add("type-arguments", node);
        break;
      }
      case ts.SyntaxKind.ImportDeclaration: {
        const declaration = node as ts.ImportDeclaration;
        const clause = declaration.importClause;
        add("import", node);
        if (!clause) add("side-effect-import", node);
        else {
          if (clause.isTypeOnly) add("import-type", node);
          if (clause.name) add("default-import", node);
          if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) add("namespace-import", node);
          if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
            if (clause.namedBindings.elements.some((element) => element.propertyName)) add("import-rename", node);
            if (clause.namedBindings.elements.some((element) => element.isTypeOnly)) add("inline-type-import", node);
          }
          if (clause.name && clause.namedBindings) add("default-and-named-import", node);
        }
        const specifier = (declaration.moduleSpecifier as ts.StringLiteral).text;
        if (specifier?.startsWith("node:")) add(`node:${specifier.slice(5)}`, node);
        break;
      }
      case ts.SyntaxKind.ExportDeclaration: {
        const declaration = node as ts.ExportDeclaration;
        if (declaration.moduleSpecifier) add("re-export", node);
        else add(declaration.isTypeOnly ? "export-type" : "export-list", node);
        break;
      }
      case ts.SyntaxKind.ExportAssignment:
        add((node as ts.ExportAssignment).isExportEquals ? "export-equals" : "export-default", node);
        break;
      case ts.SyntaxKind.VariableDeclarationList:
        add(node.flags & ts.NodeFlags.Const ? "const" : node.flags & ts.NodeFlags.Let ? "let" : "var", node);
        break;
      case ts.SyntaxKind.EnumDeclaration:
        add("enum", node);
        break;
      case ts.SyntaxKind.ModuleDeclaration:
        add("namespace", node);
        break;
      // TypeScript's types
      case ts.SyntaxKind.TypeAliasDeclaration:
        add("type-alias", node);
        if ((node as ts.TypeAliasDeclaration).typeParameters?.length) add("generic-type", node);
        break;
      case ts.SyntaxKind.InterfaceDeclaration: {
        const declaration = node as ts.InterfaceDeclaration;
        add("interface", node);
        if (declaration.heritageClauses?.length) add("interface-extends", node);
        if (declaration.typeParameters?.length) add("generic-type", node);
        break;
      }
      case ts.SyntaxKind.TypeParameter: {
        const parameter = node as ts.TypeParameterDeclaration;
        if (parameter.constraint && !ts.isMappedTypeNode(node.parent)) add("generic-constraint", node);
        if (parameter.default) add("generic-default", node);
        if (hasModifier(node, ts.SyntaxKind.ConstKeyword)) add("const-type-parameter", node);
        break;
      }
      case ts.SyntaxKind.PropertySignature: {
        const signature = node as ts.PropertySignature;
        if (signature.questionToken) add("optional-property", node);
        if (hasModifier(node, ts.SyntaxKind.ReadonlyKeyword)) add("readonly-modifier", node);
        break;
      }
      case ts.SyntaxKind.UnionType:
        add("union-type", node);
        break;
      case ts.SyntaxKind.IntersectionType:
        add("intersection-type", node);
        break;
      case ts.SyntaxKind.LiteralType:
        // `null` written as a type is a literal type node too: it isn't what "literal types" teaches.
        if ((node as ts.LiteralTypeNode).literal.kind !== ts.SyntaxKind.NullKeyword) add("literal-type", node);
        break;
      case ts.SyntaxKind.ArrayType:
        add("array-type", node);
        break;
      case ts.SyntaxKind.TupleType:
        add("tuple-type", node);
        break;
      case ts.SyntaxKind.TypeOperator: {
        const operator = (node as ts.TypeOperatorNode).operator;
        if (operator === ts.SyntaxKind.KeyOfKeyword) add("keyof-type", node);
        if (operator === ts.SyntaxKind.ReadonlyKeyword) add("readonly-modifier", node);
        break;
      }
      case ts.SyntaxKind.TypeQuery:
        add("typeof-type", node);
        break;
      case ts.SyntaxKind.IndexedAccessType:
        add("indexed-access-type", node);
        break;
      case ts.SyntaxKind.MappedType:
        add("mapped-type", node);
        break;
      case ts.SyntaxKind.ConditionalType:
        add("conditional-type", node);
        break;
      case ts.SyntaxKind.InferType:
        add("infer-type", node);
        break;
      case ts.SyntaxKind.TemplateLiteralType:
        add("template-literal-type", node);
        break;
      case ts.SyntaxKind.IndexSignature:
        add("index-signature", node);
        break;
      case ts.SyntaxKind.FunctionType:
        add("function-type", node);
        break;
      case ts.SyntaxKind.SatisfiesExpression:
        add("satisfies", node);
        break;
      case ts.SyntaxKind.AsExpression: {
        const type = (node as ts.AsExpression).type;
        add(ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "const" ? "as-const" : "as-assertion", node);
        break;
      }
      case ts.SyntaxKind.NonNullExpression:
        add("non-null-assertion", node);
        break;
      case ts.SyntaxKind.TypePredicate:
        add((node as ts.TypePredicateNode).assertsModifier ? "assertion-function" : "type-predicate", node);
        break;
      case ts.SyntaxKind.TypeReference: {
        const name = (node as ts.TypeReferenceNode).typeName;
        if (ts.isIdentifier(name) && UTILITY_TYPES.has(name.text)) add(`utility:${name.text}`, node);
        break;
      }
      default: {
        const keyword = KEYWORD_TYPES[node.kind];
        if (keyword) add(keyword, node);
      }
    }
    if (ts.isStatement(node) && hasModifier(node, ts.SyntaxKind.DeclareKeyword)) add("declare", node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return Object.fromEntries([...found].map(([key, lines]) => [key, [...lines].sort((a, b) => a - b)]));
}

function findFunction(node: ts.Node): ts.Node | null {
  for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent)) return parent;
  return null;
}

function returnsFunction(fn: ts.ArrowFunction | ts.FunctionDeclaration): boolean {
  const body = fn.body;
  if (!body) return false;
  if (!ts.isBlock(body)) return ts.isArrowFunction(body) || ts.isFunctionExpression(body);
  return body.statements.some((statement) => ts.isReturnStatement(statement) && Boolean(statement.expression) && (ts.isArrowFunction(statement.expression!) || ts.isFunctionExpression(statement.expression!)));
}

function callsItself(body: ts.Node, name: string): boolean {
  let found = false;
  const look = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) found = true;
    else ts.forEachChild(node, look);
  };
  look(body);
  return found;
}
