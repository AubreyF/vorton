function rejectDuplicateKeys(source: string): void {
  let index = 0;
  const whitespace = () => {
    while (/\s/.test(source[index] ?? "")) index += 1;
  };
  const stringToken = (): string => {
    const start = index++;
    while (index < source.length) {
      if (source[index] === "\\") index += 2;
      else if (source[index++] === '"') break;
    }
    return JSON.parse(source.slice(start, index)) as string;
  };
  const value = (): void => {
    whitespace();
    if (source[index] === "{") {
      index += 1;
      const keys = new Set<string>();
      whitespace();
      while (source[index] !== "}") {
        const key = stringToken();
        if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
        keys.add(key);
        whitespace();
        if (source[index++] !== ":") throw new Error("Invalid JSON object");
        value();
        whitespace();
        if (source[index] === ",") {
          index += 1;
          whitespace();
        } else break;
      }
      if (source[index++] !== "}") throw new Error("Invalid JSON object");
      return;
    }
    if (source[index] === "[") {
      index += 1;
      whitespace();
      while (source[index] !== "]") {
        value();
        whitespace();
        if (source[index] === ",") {
          index += 1;
          whitespace();
        } else break;
      }
      if (source[index++] !== "]") throw new Error("Invalid JSON array");
      return;
    }
    if (source[index] === '"') stringToken();
    else
      while (index < source.length && !/[\s,\]}]/.test(source[index]!))
        index += 1;
  };
  value();
}

export function parseStrictJson(source: string, description: string): unknown {
  try {
    rejectDuplicateKeys(source);
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `${description} is not unambiguous JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
