function offsetToLocation(source, offset) {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r\n|[\n\r\u2028\u2029]/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function findInvalidJsonOffset(source) {
  let offset = 0;
  const fail = () => {
    throw offset;
  };
  const skipWhitespace = () => {
    while (offset < source.length && /[\t\n\r ]/.test(source[offset])) offset += 1;
  };
  const parseString = () => {
    if (source[offset] !== '"') fail();
    offset += 1;
    while (offset < source.length) {
      const character = source[offset];
      if (character === '"') {
        offset += 1;
        return;
      }
      if (character === "\\") {
        offset += 1;
        if (offset >= source.length || !/["\\/bfnrtu]/.test(source[offset])) fail();
        if (source[offset] === "u") {
          for (let index = 1; index <= 4; index += 1) {
            if (!/[0-9a-f]/i.test(source[offset + index] ?? "")) {
              offset += index;
              fail();
            }
          }
          offset += 4;
        }
      } else if (character.charCodeAt(0) <= 0x1f) {
        fail();
      }
      offset += 1;
    }
    fail();
  };
  const parseNumber = () => {
    if (source[offset] === "-") offset += 1;
    if (source[offset] === "0") {
      offset += 1;
      if (/[0-9]/.test(source[offset] ?? "")) fail();
    } else {
      if (!/[1-9]/.test(source[offset] ?? "")) fail();
      while (/[0-9]/.test(source[offset] ?? "")) offset += 1;
    }
    if (source[offset] === ".") {
      offset += 1;
      if (!/[0-9]/.test(source[offset] ?? "")) fail();
      while (/[0-9]/.test(source[offset] ?? "")) offset += 1;
    }
    if (/[eE]/.test(source[offset] ?? "")) {
      offset += 1;
      if (/[+-]/.test(source[offset] ?? "")) offset += 1;
      if (!/[0-9]/.test(source[offset] ?? "")) fail();
      while (/[0-9]/.test(source[offset] ?? "")) offset += 1;
    }
  };
  const parseLiteral = (literal) => {
    if (source.slice(offset, offset + literal.length) !== literal) fail();
    offset += literal.length;
  };
  const parseValue = () => {
    skipWhitespace();
    const character = source[offset];
    if (character === '"') parseString();
    else if (character === "{") parseObject();
    else if (character === "[") parseArray();
    else if (character === "t") parseLiteral("true");
    else if (character === "f") parseLiteral("false");
    else if (character === "n") parseLiteral("null");
    else if (character === "-" || /[0-9]/.test(character ?? "")) parseNumber();
    else fail();
    skipWhitespace();
  };
  const parseObject = () => {
    offset += 1;
    skipWhitespace();
    if (source[offset] === "}") {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      parseString();
      skipWhitespace();
      if (source[offset] !== ":") fail();
      offset += 1;
      parseValue();
      if (source[offset] === "}") {
        offset += 1;
        return;
      }
      if (source[offset] !== ",") fail();
      offset += 1;
      skipWhitespace();
    }
    fail();
  };
  const parseArray = () => {
    offset += 1;
    skipWhitespace();
    if (source[offset] === "]") {
      offset += 1;
      return;
    }
    while (offset < source.length) {
      parseValue();
      if (source[offset] === "]") {
        offset += 1;
        return;
      }
      if (source[offset] !== ",") fail();
      offset += 1;
    }
    fail();
  };

  try {
    parseValue();
    if (offset !== source.length) fail();
    return null;
  } catch (invalidOffset) {
    return typeof invalidOffset === "number" ? invalidOffset : offset;
  }
}

export function parseDependencyPackageJson({ contents, label }) {
  const offset = findInvalidJsonOffset(contents);
  if (offset !== null) {
    const { line, column } = offsetToLocation(contents, offset);
    throw new Error(
      `${label} is invalid: DEPENDENCY_PACKAGE_JSON_INVALID at ${line}:${column}`,
    );
  }
  return JSON.parse(contents);
}