type FormulaTokenType =
  | "number"
  | "string"
  | "identifier"
  | "operator"
  | "paren"
  | "comma"
  | "eof";

type FormulaToken = {
  type: FormulaTokenType;
  value: string;
  position: number;
};

type FormulaNode =
  | { type: "literal"; value: unknown }
  | { type: "reference"; path: string[] }
  | { type: "unary"; operator: "!" | "-"; operand: FormulaNode }
  | {
      type: "binary";
      operator: "||" | "&&" | "==" | "!=" | ">" | ">=" | "<" | "<=" | "+" | "-" | "*" | "/" | "%";
      left: FormulaNode;
      right: FormulaNode;
    }
  | { type: "call"; name: string; args: FormulaNode[] };

const ALLOWED_ROOTS = new Set(["inputs", "outputs", "deps", "context"]);
const ALLOWED_FUNCTIONS = new Set(["abs", "coalesce", "if", "max", "min", "round"]);
const MAX_AST_DEPTH = 24;

class FormulaParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaParseError";
  }
}

type FormulaParserState = {
  tokens: FormulaToken[];
  index: number;
};

function tokenizeFormula(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;

  while (index < formula.length) {
    const current = formula[index];
    if (!current) {
      break;
    }

    if (/\s/.test(current)) {
      index += 1;
      continue;
    }

    if (/[0-9]/.test(current) || (current === "." && /[0-9]/.test(formula[index + 1] ?? ""))) {
      let end = index + 1;
      while (end < formula.length && /[0-9.]/.test(formula[end] ?? "")) {
        end += 1;
      }
      tokens.push({ type: "number", value: formula.slice(index, end), position: index });
      index = end;
      continue;
    }

    if (current === "'" || current === "\"") {
      const quote = current;
      let end = index + 1;
      let value = "";
      while (end < formula.length) {
        const char = formula[end];
        if (!char) {
          break;
        }
        if (char === "\\" && end + 1 < formula.length) {
          value += formula[end + 1];
          end += 2;
          continue;
        }
        if (char === quote) {
          break;
        }
        value += char;
        end += 1;
      }
      if (formula[end] !== quote) {
        throw new FormulaParseError("Unterminated string literal.");
      }
      tokens.push({ type: "string", value, position: index });
      index = end + 1;
      continue;
    }

    if (/[A-Za-z_]/.test(current)) {
      let end = index + 1;
      while (end < formula.length && /[A-Za-z0-9_]/.test(formula[end] ?? "")) {
        end += 1;
      }
      tokens.push({ type: "identifier", value: formula.slice(index, end), position: index });
      index = end;
      continue;
    }

    const twoCharOperator = formula.slice(index, index + 2);
    if (["&&", "||", "==", "!=", "<=", ">="].includes(twoCharOperator)) {
      tokens.push({ type: "operator", value: twoCharOperator, position: index });
      index += 2;
      continue;
    }

    if (["+", "-", "*", "/", "%", "!", "<", ">", "."].includes(current)) {
      tokens.push({ type: "operator", value: current, position: index });
      index += 1;
      continue;
    }

    if (["(", ")"].includes(current)) {
      tokens.push({ type: "paren", value: current, position: index });
      index += 1;
      continue;
    }

    if (current === ",") {
      tokens.push({ type: "comma", value: current, position: index });
      index += 1;
      continue;
    }

    throw new FormulaParseError(`Unsupported token "${current}" at position ${index}.`);
  }

  tokens.push({ type: "eof", value: "", position: formula.length });
  return tokens;
}

function peekToken(state: FormulaParserState) {
  return state.tokens[state.index] ?? state.tokens[state.tokens.length - 1];
}

function consumeToken(state: FormulaParserState) {
  const token = peekToken(state);
  state.index += 1;
  return token;
}

function expectToken(state: FormulaParserState, type: FormulaTokenType, value?: string) {
  const token = consumeToken(state);
  if (token.type !== type || (value !== undefined && token.value !== value)) {
    throw new FormulaParseError(
      value !== undefined
        ? `Expected ${type} "${value}" at position ${token.position}.`
        : `Expected ${type} at position ${token.position}.`,
    );
  }
  return token;
}

function parseFormulaPrimary(state: FormulaParserState): FormulaNode {
  const token = peekToken(state);
  if (token.type === "number") {
    consumeToken(state);
    const parsed = Number(token.value);
    if (!Number.isFinite(parsed)) {
      throw new FormulaParseError(`Invalid numeric literal "${token.value}".`);
    }
    return { type: "literal", value: parsed };
  }

  if (token.type === "string") {
    consumeToken(state);
    return { type: "literal", value: token.value };
  }

  if (token.type === "identifier") {
    consumeToken(state);
    if (token.value === "true") {
      return { type: "literal", value: true };
    }
    if (token.value === "false") {
      return { type: "literal", value: false };
    }
    if (token.value === "null") {
      return { type: "literal", value: null };
    }

    const path = [token.value];
    while (peekToken(state).type === "operator" && peekToken(state).value === ".") {
      consumeToken(state);
      const nextToken = expectToken(state, "identifier");
      path.push(nextToken.value);
    }

    if (path.length === 1 && peekToken(state).type === "paren" && peekToken(state).value === "(") {
      consumeToken(state);
      const args: FormulaNode[] = [];
      if (!(peekToken(state).type === "paren" && peekToken(state).value === ")")) {
        do {
          args.push(parseFormulaExpression(state));
          if (peekToken(state).type !== "comma") {
            break;
          }
          consumeToken(state);
        } while (true);
      }
      expectToken(state, "paren", ")");
      return { type: "call", name: path[0] ?? "", args };
    }

    return { type: "reference", path };
  }

  if (token.type === "paren" && token.value === "(") {
    consumeToken(state);
    const node = parseFormulaExpression(state);
    expectToken(state, "paren", ")");
    return node;
  }

  throw new FormulaParseError(`Unexpected token "${token.value}" at position ${token.position}.`);
}

function parseFormulaUnary(state: FormulaParserState): FormulaNode {
  const token = peekToken(state);
  if (token.type === "operator" && (token.value === "!" || token.value === "-")) {
    consumeToken(state);
    return {
      type: "unary",
      operator: token.value,
      operand: parseFormulaUnary(state),
    };
  }
  return parseFormulaPrimary(state);
}

function parseLeftAssociativeBinary(
  state: FormulaParserState,
  parseNext: (state: FormulaParserState) => FormulaNode,
  operators: string[],
): FormulaNode {
  let node = parseNext(state);
  while (peekToken(state).type === "operator" && operators.includes(peekToken(state).value)) {
    const operator = consumeToken(state).value as Extract<FormulaNode, { type: "binary" }>["operator"];
    const right = parseNext(state);
    node = {
      type: "binary",
      operator,
      left: node,
      right,
    };
  }
  return node;
}

function parseFormulaMultiplicative(state: FormulaParserState) {
  return parseLeftAssociativeBinary(state, parseFormulaUnary, ["*", "/", "%"]);
}

function parseFormulaAdditive(state: FormulaParserState) {
  return parseLeftAssociativeBinary(state, parseFormulaMultiplicative, ["+", "-"]);
}

function parseFormulaComparison(state: FormulaParserState) {
  return parseLeftAssociativeBinary(state, parseFormulaAdditive, [">", ">=", "<", "<="]);
}

function parseFormulaEquality(state: FormulaParserState) {
  return parseLeftAssociativeBinary(state, parseFormulaComparison, ["==", "!="]);
}

function parseFormulaAnd(state: FormulaParserState) {
  return parseLeftAssociativeBinary(state, parseFormulaEquality, ["&&"]);
}

function parseFormulaOr(state: FormulaParserState) {
  return parseLeftAssociativeBinary(state, parseFormulaAnd, ["||"]);
}

function parseFormulaExpression(state: FormulaParserState) {
  return parseFormulaOr(state);
}

function validateFormulaNode(node: FormulaNode, depth = 1): void {
  if (depth > MAX_AST_DEPTH) {
    throw new FormulaParseError(`Formula exceeds the maximum AST depth of ${MAX_AST_DEPTH}.`);
  }

  if (node.type === "reference") {
    const root = node.path[0] ?? "";
    if (!ALLOWED_ROOTS.has(root)) {
      throw new FormulaParseError(`Unsupported reference root "${root}".`);
    }
    return;
  }

  if (node.type === "call") {
    if (!ALLOWED_FUNCTIONS.has(node.name)) {
      throw new FormulaParseError(`Unsupported function "${node.name}".`);
    }
    for (const arg of node.args) {
      validateFormulaNode(arg, depth + 1);
    }
    return;
  }

  if (node.type === "unary") {
    validateFormulaNode(node.operand, depth + 1);
    return;
  }

  if (node.type === "binary") {
    validateFormulaNode(node.left, depth + 1);
    validateFormulaNode(node.right, depth + 1);
  }
}

function parseFormulaAst(formula: string): FormulaNode {
  const state: FormulaParserState = {
    tokens: tokenizeFormula(formula),
    index: 0,
  };

  const ast = parseFormulaExpression(state);
  const trailing = peekToken(state);
  if (trailing.type !== "eof") {
    throw new FormulaParseError(`Unexpected trailing token "${trailing.value}" at position ${trailing.position}.`);
  }

  validateFormulaNode(ast);
  return ast;
}

function resolveReferencePath(path: string[], context: Record<string, unknown>) {
  let current: unknown = context;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = Reflect.get(current as Record<string, unknown>, segment);
  }
  return current ?? null;
}

function asNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBooleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.length > 0 && value !== "false" && value !== "0";
  }
  return true;
}

function evaluateFormulaCall(name: string, args: unknown[]) {
  switch (name) {
    case "abs": {
      const value = asNumericValue(args[0]);
      return value === null ? null : Math.abs(value);
    }
    case "coalesce":
      return args.find((value) => value !== null && value !== undefined) ?? null;
    case "if":
      return asBooleanValue(args[0]) ? (args[1] ?? null) : (args[2] ?? null);
    case "max": {
      const values = args.map(asNumericValue).filter((value): value is number => value !== null);
      return values.length > 0 ? Math.max(...values) : null;
    }
    case "min": {
      const values = args.map(asNumericValue).filter((value): value is number => value !== null);
      return values.length > 0 ? Math.min(...values) : null;
    }
    case "round": {
      const value = asNumericValue(args[0]);
      const digits = asNumericValue(args[1]) ?? 0;
      if (value === null) {
        return null;
      }
      const factor = 10 ** Math.max(0, Math.trunc(digits));
      return Math.round(value * factor) / factor;
    }
    default:
      throw new FormulaParseError(`Unsupported function "${name}".`);
  }
}

function evaluateFormulaNode(node: FormulaNode, context: Record<string, unknown>): unknown {
  switch (node.type) {
    case "literal":
      return node.value;
    case "reference":
      return resolveReferencePath(node.path, context);
    case "call":
      return evaluateFormulaCall(
        node.name,
        node.args.map((arg) => evaluateFormulaNode(arg, context)),
      );
    case "unary": {
      const value = evaluateFormulaNode(node.operand, context);
      if (node.operator === "!") {
        return !asBooleanValue(value);
      }
      const numeric = asNumericValue(value);
      return numeric === null ? null : -numeric;
    }
    case "binary": {
      if (node.operator === "&&") {
        return asBooleanValue(evaluateFormulaNode(node.left, context)) && asBooleanValue(evaluateFormulaNode(node.right, context));
      }
      if (node.operator === "||") {
        return asBooleanValue(evaluateFormulaNode(node.left, context)) || asBooleanValue(evaluateFormulaNode(node.right, context));
      }

      const left = evaluateFormulaNode(node.left, context);
      const right = evaluateFormulaNode(node.right, context);

      switch (node.operator) {
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case ">":
        case ">=":
        case "<":
        case "<=": {
          const leftValue = asNumericValue(left);
          const rightValue = asNumericValue(right);
          if (leftValue === null || rightValue === null) {
            return false;
          }
          if (node.operator === ">") {
            return leftValue > rightValue;
          }
          if (node.operator === ">=") {
            return leftValue >= rightValue;
          }
          if (node.operator === "<") {
            return leftValue < rightValue;
          }
          return leftValue <= rightValue;
        }
        case "+":
        case "-":
        case "*":
        case "/":
        case "%": {
          const leftValue = asNumericValue(left);
          const rightValue = asNumericValue(right);
          if (leftValue === null || rightValue === null) {
            return null;
          }
          if ((node.operator === "/" || node.operator === "%") && rightValue === 0) {
            return null;
          }
          if (node.operator === "+") {
            return leftValue + rightValue;
          }
          if (node.operator === "-") {
            return leftValue - rightValue;
          }
          if (node.operator === "*") {
            return leftValue * rightValue;
          }
          if (node.operator === "/") {
            return leftValue / rightValue;
          }
          return leftValue % rightValue;
        }
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

function collectFormulaReferencesInternal(node: FormulaNode, refs: Set<string>) {
  if (node.type === "reference") {
    refs.add(node.path.join("."));
    return;
  }
  if (node.type === "unary") {
    collectFormulaReferencesInternal(node.operand, refs);
    return;
  }
  if (node.type === "binary") {
    collectFormulaReferencesInternal(node.left, refs);
    collectFormulaReferencesInternal(node.right, refs);
    return;
  }
  if (node.type === "call") {
    for (const arg of node.args) {
      collectFormulaReferencesInternal(arg, refs);
    }
  }
}

export function parseFormulaReferences(formula: string) {
  const refs = new Set<string>();
  collectFormulaReferencesInternal(parseFormulaAst(formula), refs);
  return [...refs];
}

export function parseFormulaDependencyBlockCodes(formula: string) {
  return [...new Set(
    parseFormulaReferences(formula)
      .filter((path) => path.startsWith("deps."))
      .map((path) => path.split(".")[1] ?? null)
      .filter((value): value is string => !!value),
  )];
}

export function evaluateFormula(
  formula: string,
  context: {
    inputs?: Record<string, unknown>;
    outputs?: Record<string, unknown>;
    deps?: Record<string, unknown>;
    context?: Record<string, unknown>;
  },
) {
  const ast = parseFormulaAst(formula);
  return evaluateFormulaNode(ast, {
    inputs: context.inputs ?? {},
    outputs: context.outputs ?? {},
    deps: context.deps ?? {},
    context: context.context ?? {},
  });
}
