"""Python Compass: which Python constructs a piece of code uses, and on which lines (docs/compass.md).

The platform's one definition of "the Python in this code". It reads code with Python's own parser (`ast`), so it never
guesses: an f-string is a JoinedStr node, a dict comprehension a DictComp. Used by the course inventory
(scripts/compass-inventory.py: which constructs the course uses, how often, where each first appears) and meant for the
code lens (explain this line, the error explainer), which can run this same file in the grader's sandbox.

Standard library only, Python 3.11+ (the lab runs 3.12). `detect(source)` returns {concept key: [line numbers]}; the
keys are CONCEPTS' and stay stable: cards, practice skills and learners' signals refer to them.
"""

from __future__ import annotations

import ast
import json
import re
import sys

# key: (group, label). Groups order the inventory and, later, the guide's sections.
CONCEPTS: dict[str, tuple[str, str]] = {
    # Values and names
    "assignment": ("basics", "Assigning a name"),
    "augmented-assignment": ("basics", "Updating in place (+=, -=…)"),
    "tuple-unpacking": ("basics", "Unpacking (a, b = …)"),
    "starred-unpacking": ("basics", "Starred unpacking (first, *rest = …)"),
    "walrus": ("basics", "Assignment expression (:=)"),
    "underscore-name": ("basics", "The throwaway name _"),
    "none": ("basics", "None"),
    "booleans": ("basics", "True and False"),
    "ellipsis": ("basics", "Ellipsis (...)"),
    "del-statement": ("basics", "del"),
    "global-nonlocal": ("basics", "global and nonlocal"),
    # Numbers and operators
    "true-division": ("numbers", "Division (/)"),
    "floor-division": ("numbers", "Floor division (//)"),
    "modulo": ("numbers", "Remainder (%)"),
    "power": ("numbers", "Power (**)"),
    "numeric-literals": ("numbers", "Integer and float literals"),
    "scientific-notation": ("numbers", "Scientific notation (1e-6)"),
    "comparison": ("logic", "Comparisons (==, <, >=…)"),
    "chained-comparison": ("logic", "Chained comparison (0 < x < 10)"),
    "identity-is": ("logic", "Identity (is, is not)"),
    "membership-in": ("logic", "Membership (in, not in)"),
    "boolean-operators": ("logic", "and, or"),
    "not-operator": ("logic", "not"),
    "or-default": ("logic", "A default with or (x or y)"),
    "conditional-expression": ("logic", "Conditional expression (a if c else b)"),
    "pipe-operator": ("logic", "The | operator between objects (operator overloading)"),
    # Strings
    "string-literals": ("strings", "Strings"),
    "f-string": ("strings", "f-strings"),
    "f-string-format-spec": ("strings", "Format specs in f-strings ({x:.2f})"),
    "triple-quoted-string": ("strings", "Multi-line strings (\"\"\"…\"\"\")"),
    "string-concatenation": ("strings", "Joining strings with +"),
    "str-format": ("strings", "str.format()"),
    "percent-formatting": ("strings", "% formatting"),
    "string-methods": ("strings", "String methods (strip, split, join…)"),
    "bytes": ("strings", "Bytes (b\"…\")"),
    # Collections
    "list-literal": ("collections", "Lists"),
    "tuple-literal": ("collections", "Tuples"),
    "dict-literal": ("collections", "Dictionaries"),
    "set-literal": ("collections", "Sets"),
    "indexing": ("collections", "Indexing (x[0], d[\"key\"])"),
    "negative-index": ("collections", "Negative indexes (x[-1])"),
    "slicing": ("collections", "Slicing (x[1:3])"),
    "list-comprehension": ("collections", "List comprehensions"),
    "dict-comprehension": ("collections", "Dict comprehensions"),
    "set-comprehension": ("collections", "Set comprehensions"),
    "generator-expression": ("collections", "Generator expressions"),
    "comprehension-filter": ("collections", "Filtering in a comprehension (if …)"),
    "nested-comprehension": ("collections", "Nested comprehensions"),
    "dict-unpacking": ("collections", "Merging dicts with ** ({**a, **b})"),
    "list-unpacking": ("collections", "Spreading into a list ([*a, *b])"),
    "dict-get": ("collections", "dict.get()"),
    "dict-views": ("collections", "dict.items(), .keys(), .values()"),
    "dict-mutation": ("collections", "Changing a dict (update, setdefault, pop)"),
    "list-mutation": ("collections", "Changing a list (append, extend, insert, pop, sort)"),
    # Built-in functions
    "print": ("builtins", "print()"),
    "len": ("builtins", "len()"),
    "range": ("builtins", "range()"),
    "enumerate": ("builtins", "enumerate()"),
    "zip": ("builtins", "zip()"),
    "sorted": ("builtins", "sorted()"),
    "sort-key": ("builtins", "Sorting by a key (key=…)"),
    "min-max": ("builtins", "min() and max()"),
    "sum": ("builtins", "sum()"),
    "any-all": ("builtins", "any() and all()"),
    "map-filter": ("builtins", "map() and filter()"),
    "reversed": ("builtins", "reversed()"),
    "round": ("builtins", "round()"),
    "abs": ("builtins", "abs()"),
    "type-conversion": ("builtins", "Converting types (int(), float(), str(), list()…)"),
    "isinstance": ("builtins", "isinstance()"),
    "type-function": ("builtins", "type()"),
    "attribute-functions": ("builtins", "getattr(), setattr(), hasattr()"),
    "open-file": ("builtins", "open()"),
    "input": ("builtins", "input()"),
    "repr": ("builtins", "repr()"),
    "id-hash": ("builtins", "id() and hash()"),
    "iter-next": ("builtins", "iter() and next()"),
    "callable": ("builtins", "callable()"),
    "vars-dir": ("builtins", "vars() and dir()"),
    # Control flow
    "if-statement": ("control-flow", "if"),
    "elif": ("control-flow", "elif"),
    "else": ("control-flow", "else"),
    "for-loop": ("control-flow", "for loops"),
    "while-loop": ("control-flow", "while loops"),
    "break-continue": ("control-flow", "break and continue"),
    "loop-else": ("control-flow", "else on a loop"),
    "pass": ("control-flow", "pass"),
    "match-statement": ("control-flow", "match / case"),
    "main-guard": ("control-flow", "if __name__ == \"__main__\""),
    # Functions
    "function-def": ("functions", "Defining functions (def)"),
    "return": ("functions", "return"),
    "default-arguments": ("functions", "Default argument values"),
    "keyword-arguments": ("functions", "Calling with keyword arguments (f(x=1))"),
    "args": ("functions", "*args"),
    "kwargs": ("functions", "**kwargs"),
    "keyword-only-arguments": ("functions", "Keyword-only parameters (after *)"),
    "positional-only-arguments": ("functions", "Positional-only parameters (before /)"),
    "call-unpacking": ("functions", "Unpacking into a call (f(*a, **kw))"),
    "lambda": ("functions", "lambda"),
    "nested-function": ("functions", "Functions inside functions (closures)"),
    "decorator": ("functions", "Decorators (@…)"),
    "docstring": ("functions", "Docstrings"),
    "method-call-chain": ("functions", "Chaining calls (a.b().c())"),
    # Type hints
    "type-hints": ("typing", "Type hints"),
    "return-annotation": ("typing", "Return type hints (-> …)"),
    "generic-hints": ("typing", "Generic hints (list[str], dict[str, int])"),
    "optional-union": ("typing", "Optional values (X | None, Optional[X])"),
    "literal-type": ("typing", "Literal[…]"),
    "annotated-type": ("typing", "Annotated[…]"),
    "callable-type": ("typing", "Callable[…]"),
    "any-type": ("typing", "Any"),
    "typed-dict": ("typing", "TypedDict"),
    "annotated-assignment": ("typing", "Annotated variables (x: int = 0)"),
    # Classes
    "class-def": ("classes", "Classes"),
    "init-method": ("classes", "__init__"),
    "self": ("classes", "self and instance attributes"),
    "inheritance": ("classes", "Inheritance"),
    "super-call": ("classes", "super()"),
    "dataclass": ("classes", "Dataclasses (@dataclass)"),
    "pydantic-model": ("classes", "Pydantic models (BaseModel)"),
    "field-defaults": ("classes", "Class fields with defaults"),
    "property": ("classes", "@property"),
    "classmethod-staticmethod": ("classes", "@classmethod and @staticmethod"),
    "dunder-methods": ("classes", "Special methods (__repr__, __call__…)"),
    "enum": ("classes", "Enums"),
    "custom-exception": ("classes", "Your own exception classes"),
    "abstract-protocol": ("classes", "Abstract classes and Protocols"),
    # Errors
    "try-except": ("errors", "try / except"),
    "except-as": ("errors", "except … as e"),
    "multiple-except": ("errors", "Several except blocks"),
    "finally": ("errors", "finally"),
    "try-else": ("errors", "else on a try"),
    "raise": ("errors", "raise"),
    "raise-from": ("errors", "raise … from …"),
    "assert": ("errors", "assert"),
    # Context managers, iteration, async
    "with-statement": ("resources", "with (context managers)"),
    "generator-function": ("iteration", "Generators (yield)"),
    "yield-from": ("iteration", "yield from"),
    "async-def": ("async", "async def"),
    "await": ("async", "await"),
    "top-level-await": ("async", "await at the top of a notebook cell"),
    "async-for": ("async", "async for"),
    "async-with": ("async", "async with"),
    "asyncio-run": ("async", "asyncio.run()"),
    "asyncio-gather": ("async", "asyncio.gather()"),
    "async-comprehension": ("async", "Async comprehensions"),
    # Modules
    "import": ("modules", "import"),
    "from-import": ("modules", "from … import …"),
    "import-alias": ("modules", "import … as …"),
    "relative-import": ("modules", "Relative imports (from . import …)"),
    # Notebooks
    "jupyter-magic": ("notebooks", "Notebook commands (%pip, !ls)"),
    "display": ("notebooks", "display()"),
}

# The same labels in Latin American Spanish, technical terms left in English the way developers say them.
LABELS_ES: dict[str, str] = {
    "assignment": "Asignar un nombre", "augmented-assignment": "Actualizar en el lugar (+=, -=…)",
    "tuple-unpacking": "Desempaquetar (a, b = …)", "starred-unpacking": "Desempaquetar con * (first, *rest = …)",
    "walrus": "Expresión de asignación (:=)", "underscore-name": "El nombre descartable _", "none": "None",
    "booleans": "True y False", "ellipsis": "Ellipsis (...)", "del-statement": "del", "global-nonlocal": "global y nonlocal",
    "true-division": "División (/)", "floor-division": "División entera (//)", "modulo": "Residuo (%)",
    "power": "Potencia (**)", "numeric-literals": "Números enteros y decimales", "scientific-notation": "Notación científica (1e-6)",
    "comparison": "Comparaciones (==, <, >=…)", "chained-comparison": "Comparación encadenada (0 < x < 10)",
    "identity-is": "Identidad (is, is not)", "membership-in": "Pertenencia (in, not in)", "boolean-operators": "and, or",
    "not-operator": "not", "or-default": "Un valor por defecto con or (x or y)",
    "conditional-expression": "Expresión condicional (a if c else b)",
    "pipe-operator": "El operador | entre objetos (sobrecarga de operadores)",
    "string-literals": "Strings", "f-string": "f-strings", "f-string-format-spec": "Formato en f-strings ({x:.2f})",
    "triple-quoted-string": "Strings de varias líneas (\"\"\"…\"\"\")", "string-concatenation": "Unir strings con +",
    "str-format": "str.format()", "percent-formatting": "Formato con %",
    "string-methods": "Métodos de strings (strip, split, join…)", "bytes": "Bytes (b\"…\")",
    "list-literal": "Listas", "tuple-literal": "Tuplas", "dict-literal": "Diccionarios", "set-literal": "Sets",
    "indexing": "Acceder por índice o clave (x[0], d[\"key\"])", "negative-index": "Índices negativos (x[-1])",
    "slicing": "Slicing (x[1:3])", "list-comprehension": "List comprehensions", "dict-comprehension": "Dict comprehensions",
    "set-comprehension": "Set comprehensions", "generator-expression": "Generator expressions",
    "comprehension-filter": "Filtrar en una comprehension (if …)", "nested-comprehension": "Comprehensions anidadas",
    "dict-unpacking": "Combinar diccionarios con ** ({**a, **b})", "list-unpacking": "Expandir en una lista ([*a, *b])",
    "dict-get": "dict.get()", "dict-views": "dict.items(), .keys(), .values()",
    "dict-mutation": "Modificar un diccionario (update, setdefault, pop)",
    "list-mutation": "Modificar una lista (append, extend, insert, pop, sort)",
    "print": "print()", "len": "len()", "range": "range()", "enumerate": "enumerate()", "zip": "zip()",
    "sorted": "sorted()", "sort-key": "Ordenar por una clave (key=…)", "min-max": "min() y max()", "sum": "sum()",
    "any-all": "any() y all()", "map-filter": "map() y filter()", "reversed": "reversed()", "round": "round()",
    "abs": "abs()", "type-conversion": "Convertir tipos (int(), float(), str(), list()…)", "isinstance": "isinstance()",
    "type-function": "type()", "attribute-functions": "getattr(), setattr(), hasattr()", "open-file": "open()",
    "input": "input()", "repr": "repr()", "id-hash": "id() y hash()", "iter-next": "iter() y next()",
    "callable": "callable()", "vars-dir": "vars() y dir()",
    "if-statement": "if", "elif": "elif", "else": "else", "for-loop": "Bucles for", "while-loop": "Bucles while",
    "break-continue": "break y continue", "loop-else": "else en un bucle", "pass": "pass",
    "match-statement": "match / case", "main-guard": "if __name__ == \"__main__\"",
    "function-def": "Definir funciones (def)", "return": "return", "default-arguments": "Valores por defecto de los parámetros",
    "keyword-arguments": "Llamar con argumentos por nombre (f(x=1))", "args": "*args", "kwargs": "**kwargs",
    "keyword-only-arguments": "Parámetros solo por nombre (después de *)",
    "positional-only-arguments": "Parámetros solo por posición (antes de /)",
    "call-unpacking": "Desempaquetar en una llamada (f(*a, **kw))", "lambda": "lambda",
    "nested-function": "Funciones dentro de funciones (closures)", "decorator": "Decoradores (@…)",
    "docstring": "Docstrings", "method-call-chain": "Encadenar llamadas (a.b().c())",
    "type-hints": "Type hints", "return-annotation": "Type hints de retorno (-> …)",
    "generic-hints": "Type hints genéricos (list[str], dict[str, int])",
    "optional-union": "Valores opcionales (X | None, Optional[X])", "literal-type": "Literal[…]",
    "annotated-type": "Annotated[…]", "callable-type": "Callable[…]", "any-type": "Any", "typed-dict": "TypedDict",
    "annotated-assignment": "Variables con type hint (x: int = 0)",
    "class-def": "Clases", "init-method": "__init__", "self": "self y los atributos de instancia", "inheritance": "Herencia",
    "super-call": "super()", "dataclass": "Dataclasses (@dataclass)", "pydantic-model": "Modelos de Pydantic (BaseModel)",
    "field-defaults": "Campos de clase con valor por defecto", "property": "@property",
    "classmethod-staticmethod": "@classmethod y @staticmethod",
    "dunder-methods": "Métodos especiales (__repr__, __call__…)", "enum": "Enums",
    "custom-exception": "Tus propias excepciones", "abstract-protocol": "Clases abstractas y Protocols",
    "try-except": "try / except", "except-as": "except … as e", "multiple-except": "Varios bloques except",
    "finally": "finally", "try-else": "else en un try", "raise": "raise", "raise-from": "raise … from …", "assert": "assert",
    "with-statement": "with (context managers)", "generator-function": "Generadores (yield)", "yield-from": "yield from",
    "async-def": "async def", "await": "await", "top-level-await": "await al inicio de una celda del notebook",
    "async-for": "async for", "async-with": "async with", "asyncio-run": "asyncio.run()",
    "asyncio-gather": "asyncio.gather()", "async-comprehension": "Comprehensions asíncronas",
    "import": "import", "from-import": "from … import …", "import-alias": "import … as …",
    "relative-import": "Imports relativos (from . import …)",
    "jupyter-magic": "Comandos del notebook (%pip, !ls)", "display": "display()",
}

# The standard library and the course's everyday packages: "stdlib:<module>" / "package:<name>" keys, by top-level
# import. They aren't syntax, but a card on `pathlib` or `json` is as useful as one on f-strings.
STDLIB = {
    "os", "sys", "pathlib", "json", "re", "math", "random", "time", "datetime", "collections", "itertools", "functools",
    "typing", "dataclasses", "enum", "abc", "asyncio", "logging", "uuid", "csv", "textwrap", "operator", "statistics",
    "string", "copy", "pprint", "tempfile", "shutil", "subprocess", "contextlib", "hashlib", "base64", "secrets",
    "urllib", "http", "io", "inspect", "warnings", "traceback", "concurrent", "threading", "decimal", "fractions",
    "zoneinfo", "glob", "sqlite3", "getpass", "platform", "importlib", "types", "timeit", "difflib", "html", "xml",
}
PACKAGES = {"dotenv", "pydantic", "pandas", "numpy", "requests", "httpx", "tiktoken", "matplotlib", "rich", "pytest", "IPython"}

STRING_METHODS = {
    "strip", "lstrip", "rstrip", "split", "rsplit", "splitlines", "join", "replace", "upper", "lower", "title",
    "capitalize", "startswith", "endswith", "find", "rfind", "count", "isdigit", "isalpha", "isalnum", "zfill",
    "ljust", "rjust", "center", "removeprefix", "removesuffix", "casefold", "partition", "encode", "decode",
}
DICT_VIEWS = {"items", "keys", "values"}
DICT_MUTATION = {"update", "setdefault", "popitem"}
LIST_MUTATION = {"append", "extend", "insert", "remove", "sort", "reverse", "clear"}
CONVERSIONS = {"int", "float", "str", "list", "dict", "tuple", "set", "bool", "frozenset"}
SIMPLE_BUILTINS = {
    "print": "print", "len": "len", "range": "range", "enumerate": "enumerate", "zip": "zip", "sorted": "sorted",
    "min": "min-max", "max": "min-max", "sum": "sum", "any": "any-all", "all": "any-all", "map": "map-filter",
    "filter": "map-filter", "reversed": "reversed", "round": "round", "abs": "abs", "isinstance": "isinstance",
    "type": "type-function", "getattr": "attribute-functions", "setattr": "attribute-functions",
    "hasattr": "attribute-functions", "open": "open-file", "input": "input", "repr": "repr", "id": "id-hash",
    "hash": "id-hash", "iter": "iter-next", "next": "iter-next", "callable": "callable", "vars": "vars-dir",
    "dir": "vars-dir", "display": "display", "super": "super-call",
}
TYPING_NAMES = {
    "Optional": "optional-union", "Union": "optional-union", "Literal": "literal-type", "Annotated": "annotated-type",
    "Callable": "callable-type", "Any": "any-type", "TypedDict": "typed-dict",
}


def label(key: str) -> tuple[str, str, str]:
    """The group and the English and Spanish labels of any key, the stdlib and package ones included."""
    if key in CONCEPTS:
        group, english = CONCEPTS[key]
        return group, english, LABELS_ES.get(key, english)
    kind, _, name = key.partition(":")
    return ("standard-library" if kind == "stdlib" else "packages", name, name)


class _Detector(ast.NodeVisitor):
    def __init__(self) -> None:
        self.found: dict[str, set[int]] = {}
        self._annotation_depth = 0
        self._function_depth = 0
        self._class_depth = 0

    def hit(self, key: str, node: ast.AST) -> None:
        line = getattr(node, "lineno", None)
        if line is not None:
            self.found.setdefault(key, set()).add(line)

    # -- annotations: X | None there is a type, not the pipe operator --------------------------------------------
    def annotation(self, node: ast.AST | None) -> None:
        if node is None:
            return
        self._annotation_depth += 1
        self.hit("type-hints", node)
        for child in ast.walk(node):
            if isinstance(child, ast.Subscript):
                base = child.value
                name = base.id if isinstance(base, ast.Name) else base.attr if isinstance(base, ast.Attribute) else None
                if name in TYPING_NAMES:
                    self.hit(TYPING_NAMES[name], child)
                elif name in {"list", "dict", "set", "tuple", "type", "List", "Dict", "Set", "Tuple", "Sequence", "Iterable", "Mapping"}:
                    self.hit("generic-hints", child)
            elif isinstance(child, ast.BinOp) and isinstance(child.op, ast.BitOr):
                if any(isinstance(side, ast.Constant) and side.value is None for side in (child.left, child.right)):
                    self.hit("optional-union", child)
            elif isinstance(child, ast.Name) and child.id in TYPING_NAMES:
                self.hit(TYPING_NAMES[child.id], child)
        self.visit(node)
        self._annotation_depth -= 1

    # -- statements ---------------------------------------------------------------------------------------------
    def visit_Assign(self, node: ast.Assign) -> None:
        self.hit("assignment", node)
        for target in node.targets:
            self._target(target)
        self.generic_visit(node)

    def _target(self, target: ast.AST) -> None:
        if isinstance(target, (ast.Tuple, ast.List)):
            self.hit("tuple-unpacking", target)
            for element in target.elts:
                if isinstance(element, ast.Starred):
                    self.hit("starred-unpacking", element)
                if isinstance(element, ast.Name) and element.id == "_":
                    self.hit("underscore-name", element)
        elif isinstance(target, ast.Name) and target.id == "_":
            self.hit("underscore-name", target)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self.hit("augmented-assignment", node)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self.hit("annotated-assignment", node)
        if self._class_depth and not self._function_depth and node.value is not None:
            self.hit("field-defaults", node)
        self.annotation(node.annotation)
        if node.value is not None:
            self.visit(node.value)

    def visit_NamedExpr(self, node: ast.NamedExpr) -> None:
        self.hit("walrus", node)
        self.generic_visit(node)

    def visit_Delete(self, node: ast.Delete) -> None:
        self.hit("del-statement", node)
        self.generic_visit(node)

    def visit_Global(self, node: ast.Global) -> None:
        self.hit("global-nonlocal", node)

    def visit_Nonlocal(self, node: ast.Nonlocal) -> None:
        self.hit("global-nonlocal", node)

    def visit_If(self, node: ast.If) -> None:
        test = node.test
        if (
            isinstance(test, ast.Compare)
            and isinstance(test.left, ast.Name)
            and test.left.id == "__name__"
            and any(isinstance(c, ast.Constant) and c.value == "__main__" for c in test.comparators)
        ):
            self.hit("main-guard", node)
        self.hit("if-statement", node)
        if node.orelse:
            if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If) and node.orelse[0].col_offset == node.col_offset:
                self.hit("elif", node.orelse[0])
            else:
                self.hit("else", node.orelse[0])
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        self.hit("for-loop", node)
        self._target(node.target)
        if node.orelse:
            self.hit("loop-else", node.orelse[0])
        self.generic_visit(node)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.hit("async-for", node)
        self.visit_For(node)  # type: ignore[arg-type]

    def visit_While(self, node: ast.While) -> None:
        self.hit("while-loop", node)
        if node.orelse:
            self.hit("loop-else", node.orelse[0])
        self.generic_visit(node)

    def visit_Break(self, node: ast.Break) -> None:
        self.hit("break-continue", node)

    def visit_Continue(self, node: ast.Continue) -> None:
        self.hit("break-continue", node)

    def visit_Pass(self, node: ast.Pass) -> None:
        self.hit("pass", node)

    def visit_Match(self, node: ast.Match) -> None:
        self.hit("match-statement", node)
        self.generic_visit(node)

    def visit_Try(self, node: ast.Try) -> None:
        self.hit("try-except", node)
        if len(node.handlers) > 1:
            self.hit("multiple-except", node.handlers[1])
        for handler in node.handlers:
            if handler.name:
                self.hit("except-as", handler)
        if node.finalbody:
            self.hit("finally", node.finalbody[0])
        if node.orelse:
            self.hit("try-else", node.orelse[0])
        self.generic_visit(node)

    visit_TryStar = visit_Try

    def visit_Raise(self, node: ast.Raise) -> None:
        self.hit("raise", node)
        if node.cause is not None:
            self.hit("raise-from", node)
        self.generic_visit(node)

    def visit_Assert(self, node: ast.Assert) -> None:
        self.hit("assert", node)
        self.generic_visit(node)

    def visit_With(self, node: ast.With) -> None:
        self.hit("with-statement", node)
        self.generic_visit(node)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        self.hit("async-with", node)
        self.hit("with-statement", node)
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        self.hit("import", node)
        for alias in node.names:
            self._module(alias.name, node)
            if alias.asname:
                self.hit("import-alias", node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        self.hit("from-import", node)
        if node.level:
            self.hit("relative-import", node)
        if node.module:
            self._module(node.module, node)
        if any(alias.asname for alias in node.names):
            self.hit("import-alias", node)

    def _module(self, name: str, node: ast.AST) -> None:
        top = name.split(".")[0]
        if top in STDLIB:
            self.hit(f"stdlib:{top}", node)
        elif top in PACKAGES:
            self.hit(f"package:{top}", node)

    # -- definitions --------------------------------------------------------------------------------------------
    def _function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        self.hit("function-def", node)
        if self._function_depth:
            self.hit("nested-function", node)
        if self._class_depth and not self._function_depth:
            if node.name == "__init__":
                self.hit("init-method", node)
            elif node.name.startswith("__") and node.name.endswith("__"):
                self.hit("dunder-methods", node)
        arguments = node.args
        if arguments.defaults or any(default is not None for default in arguments.kw_defaults):
            self.hit("default-arguments", node)
        if arguments.vararg:
            self.hit("args", node)
        if arguments.kwarg:
            self.hit("kwargs", node)
        if arguments.kwonlyargs:
            self.hit("keyword-only-arguments", node)
        if arguments.posonlyargs:
            self.hit("positional-only-arguments", node)
        for decorator in node.decorator_list:
            self.hit("decorator", decorator)
            name = _name(decorator)
            if name == "property":
                self.hit("property", decorator)
            elif name in {"classmethod", "staticmethod"}:
                self.hit("classmethod-staticmethod", decorator)
            self.visit(decorator)
        if ast.get_docstring(node):
            self.hit("docstring", node.body[0])
        for argument in [*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs, arguments.vararg, arguments.kwarg]:
            if argument is not None and argument.annotation is not None:
                self.annotation(argument.annotation)
        if node.returns is not None:
            self.hit("return-annotation", node.returns)
            self.annotation(node.returns)
        for default in [*arguments.defaults, *[d for d in arguments.kw_defaults if d is not None]]:
            self.visit(default)
        self._function_depth += 1
        for statement in node.body:
            self.visit(statement)
        self._function_depth -= 1

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._function(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.hit("async-def", node)
        self._function(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.hit("class-def", node)
        bases = [_name(base) for base in node.bases]
        if node.bases:
            self.hit("inheritance", node)
        if "BaseModel" in bases:
            self.hit("pydantic-model", node)
        if "TypedDict" in bases:
            self.hit("typed-dict", node)
        if any(base in {"Enum", "StrEnum", "IntEnum"} for base in bases):
            self.hit("enum", node)
        if any(base in {"Exception", "ValueError", "RuntimeError", "KeyError", "TypeError"} or (base or "").endswith("Error") for base in bases):
            self.hit("custom-exception", node)
        if any(base in {"ABC", "Protocol"} for base in bases):
            self.hit("abstract-protocol", node)
        for decorator in node.decorator_list:
            self.hit("decorator", decorator)
            if _name(decorator) == "dataclass":
                self.hit("dataclass", decorator)
            self.visit(decorator)
        if ast.get_docstring(node):
            self.hit("docstring", node.body[0])
        for base in node.bases:
            self.visit(base)
        self._class_depth += 1
        saved, self._function_depth = self._function_depth, 0
        for statement in node.body:
            self.visit(statement)
        self._function_depth = saved
        self._class_depth -= 1

    def visit_Return(self, node: ast.Return) -> None:
        self.hit("return", node)
        self.generic_visit(node)

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self.hit("lambda", node)
        self.generic_visit(node)

    def visit_Yield(self, node: ast.Yield) -> None:
        self.hit("generator-function", node)
        self.generic_visit(node)

    def visit_YieldFrom(self, node: ast.YieldFrom) -> None:
        self.hit("generator-function", node)
        self.hit("yield-from", node)
        self.generic_visit(node)

    def visit_Await(self, node: ast.Await) -> None:
        self.hit("await", node)
        if not self._function_depth:
            self.hit("top-level-await", node)
        self.generic_visit(node)

    # -- expressions --------------------------------------------------------------------------------------------
    def visit_Constant(self, node: ast.Constant) -> None:
        value = node.value
        if self._annotation_depth:
            return  # `int | None` is a type, not the value None.
        if value is None:
            self.hit("none", node)
        elif isinstance(value, bool):
            self.hit("booleans", node)
        elif value is Ellipsis:
            self.hit("ellipsis", node)
        elif isinstance(value, (int, float)):
            self.hit("numeric-literals", node)
        elif isinstance(value, str):
            self.hit("string-literals", node)
        elif isinstance(value, bytes):
            self.hit("bytes", node)

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        self.hit("f-string", node)
        for value in node.values:
            if isinstance(value, ast.FormattedValue):
                if value.format_spec is not None:
                    self.hit("f-string-format-spec", value)
                self.visit(value.value)

    def visit_BinOp(self, node: ast.BinOp) -> None:
        op = node.op
        if isinstance(op, ast.FloorDiv):
            self.hit("floor-division", node)
        elif isinstance(op, ast.Div):
            self.hit("true-division", node)
        elif isinstance(op, ast.Pow):
            self.hit("power", node)
        elif isinstance(op, ast.Mod):
            self.hit("percent-formatting" if _is_str(node.left) else "modulo", node)
        elif isinstance(op, ast.Add) and (_is_str(node.left) or _is_str(node.right)):
            self.hit("string-concatenation", node)
        elif isinstance(op, ast.BitOr) and not self._annotation_depth:
            self.hit("pipe-operator", node)
        self.generic_visit(node)

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        self.hit("boolean-operators", node)
        if isinstance(node.op, ast.Or) and isinstance(node.values[-1], (ast.Constant, ast.List, ast.Dict, ast.Call)):
            self.hit("or-default", node)
        self.generic_visit(node)

    def visit_UnaryOp(self, node: ast.UnaryOp) -> None:
        if isinstance(node.op, ast.Not):
            self.hit("not-operator", node)
        self.generic_visit(node)

    def visit_Compare(self, node: ast.Compare) -> None:
        self.hit("comparison", node)
        if len(node.ops) > 1:
            self.hit("chained-comparison", node)
        for op in node.ops:
            if isinstance(op, (ast.Is, ast.IsNot)):
                self.hit("identity-is", node)
            elif isinstance(op, (ast.In, ast.NotIn)):
                self.hit("membership-in", node)
        self.generic_visit(node)

    def visit_IfExp(self, node: ast.IfExp) -> None:
        self.hit("conditional-expression", node)
        self.generic_visit(node)

    def visit_List(self, node: ast.List) -> None:
        if isinstance(node.ctx, ast.Load):
            self.hit("list-literal", node)
            if any(isinstance(element, ast.Starred) for element in node.elts):
                self.hit("list-unpacking", node)
        self.generic_visit(node)

    def visit_Tuple(self, node: ast.Tuple) -> None:
        if isinstance(node.ctx, ast.Load) and not self._annotation_depth:
            self.hit("tuple-literal", node)
        self.generic_visit(node)

    def visit_Dict(self, node: ast.Dict) -> None:
        self.hit("dict-literal", node)
        if any(key is None for key in node.keys):
            self.hit("dict-unpacking", node)
        self.generic_visit(node)

    def visit_Set(self, node: ast.Set) -> None:
        self.hit("set-literal", node)
        self.generic_visit(node)

    def _comprehension(self, key: str, node: ast.AST, generators: list[ast.comprehension]) -> None:
        self.hit(key, node)
        if len(generators) > 1:
            self.hit("nested-comprehension", node)
        for generator in generators:
            if generator.ifs:
                self.hit("comprehension-filter", generator.ifs[0])
            if generator.is_async:
                self.hit("async-comprehension", node)
        self.generic_visit(node)

    def visit_ListComp(self, node: ast.ListComp) -> None:
        self._comprehension("list-comprehension", node, node.generators)

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self._comprehension("dict-comprehension", node, node.generators)

    def visit_SetComp(self, node: ast.SetComp) -> None:
        self._comprehension("set-comprehension", node, node.generators)

    def visit_GeneratorExp(self, node: ast.GeneratorExp) -> None:
        self._comprehension("generator-expression", node, node.generators)

    def visit_Subscript(self, node: ast.Subscript) -> None:
        index = node.slice
        if isinstance(index, ast.Slice):
            self.hit("slicing", node)
        elif not self._annotation_depth:
            self.hit("indexing", node)
            if isinstance(index, ast.UnaryOp) and isinstance(index.op, ast.USub):
                self.hit("negative-index", node)
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if isinstance(node.value, ast.Name) and node.value.id == "self":
            self.hit("self", node)
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id in {"Any", "TypedDict"} and self._annotation_depth:
            self.hit(TYPING_NAMES[node.id], node)

    def visit_Call(self, node: ast.Call) -> None:
        function = node.func
        if node.keywords and any(keyword.arg is not None for keyword in node.keywords):
            self.hit("keyword-arguments", node)
        if any(isinstance(argument, ast.Starred) for argument in node.args) or any(keyword.arg is None for keyword in node.keywords):
            self.hit("call-unpacking", node)
        if isinstance(function, ast.Name):
            name = function.id
            if name in SIMPLE_BUILTINS:
                self.hit(SIMPLE_BUILTINS[name], node)
            if name in CONVERSIONS:
                self.hit("type-conversion", node)
            if name == "sorted" and any(keyword.arg == "key" for keyword in node.keywords):
                self.hit("sort-key", node)
        elif isinstance(function, ast.Attribute):
            method = function.attr
            owner = function.value
            if isinstance(owner, ast.Call):
                self.hit("method-call-chain", node)
            if method == "get":
                self.hit("dict-get", node)
            elif method in DICT_VIEWS:
                self.hit("dict-views", node)
            elif method in DICT_MUTATION:
                self.hit("dict-mutation", node)
            elif method in LIST_MUTATION:
                self.hit("list-mutation", node)
                if method == "sort" and any(keyword.arg == "key" for keyword in node.keywords):
                    self.hit("sort-key", node)
            elif method == "format" and _is_str(owner):
                self.hit("str-format", node)
            elif method in STRING_METHODS:
                self.hit("string-methods", node)
            if isinstance(owner, ast.Name) and owner.id == "asyncio":
                if method == "run":
                    self.hit("asyncio-run", node)
                elif method == "gather":
                    self.hit("asyncio-gather", node)
        self.generic_visit(node)


def _name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Call):
        node = node.func
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript):
        return _name(node.value)
    return None


def _is_str(node: ast.AST) -> bool:
    return isinstance(node, ast.JoinedStr) or (isinstance(node, ast.Constant) and isinstance(node.value, str))


_MAGIC = re.compile(r"^\s*[%!]")
_TRIPLE = re.compile(r"[rRbBuUfF]{0,2}(\"\"\"|''')")


def prepare(source: str) -> tuple[str, list[int]]:
    """Notebook cells may hold commands Python can't parse (%pip, !ls): blanked out, their lines returned."""
    lines = source.split("\n")
    magic = [index + 1 for index, line in enumerate(lines) if _MAGIC.match(line)]
    for line in magic:
        lines[line - 1] = ""
    return "\n".join(lines), magic


def detect(source: str) -> dict[str, list[int]]:
    """{concept key: sorted line numbers}. Raises SyntaxError when the code doesn't parse."""
    code, magic = prepare(source)
    tree = compile(code, "<code>", "exec", flags=ast.PyCF_ONLY_AST | ast.PyCF_ALLOW_TOP_LEVEL_AWAIT, dont_inherit=True)
    detector = _Detector()
    detector.visit(tree)
    if magic:
        detector.found["jupyter-magic"] = set(magic)
    # Multi-line strings: the tokenizer knows them, the tree doesn't.
    for index, line in enumerate(code.split("\n"), start=1):
        if _TRIPLE.search(line):
            detector.found.setdefault("triple-quoted-string", set()).add(index)
    return {key: sorted(lines) for key, lines in detector.found.items()}


if __name__ == "__main__":
    # The code lens's entry point: code on stdin, {"concepts": {...}} or {"error": ...} as JSON on stdout.
    text = sys.stdin.read()
    try:
        print(json.dumps({"concepts": detect(text)}))
    except SyntaxError as error:
        print(json.dumps({"error": {"type": "SyntaxError", "message": error.msg, "line": error.lineno}}))
