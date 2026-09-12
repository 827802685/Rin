// Schema validator - Shared between client and server
// Mirrors the server's t object

export const t = {
  Object: (properties: Record<string, any>, options?: { additionalProperties?: boolean }) => ({
    type: 'object',
    properties,
    ...options
  }),
  String: (options?: { optional?: boolean; minLength?: number; maxLength?: number }) => ({
    type: 'string',
    optional: options?.optional,
    ...(options?.minLength !== undefined ? { minLength: options.minLength } : {}),
    ...(options?.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
  }),
  Number: (options?: { optional?: boolean }) => ({ type: 'number', optional: options?.optional }),
  Boolean: (options?: { optional?: boolean }) => ({ type: 'boolean', optional: options?.optional }),
  Integer: (options?: { optional?: boolean }) => ({ type: 'number', optional: options?.optional }),
  Date: (options?: { optional?: boolean }) => ({ type: 'string', format: 'date-time', optional: options?.optional }),
  Array: (items: any, options?: { optional?: boolean }) => ({ type: 'array', items, optional: options?.optional }),
  File: (options?: { optional?: boolean }) => ({ type: 'file', optional: options?.optional }),
  Optional: (schema: any) => ({ ...schema, optional: true }),
  Numeric: (options?: { optional?: boolean }) => ({ type: 'number', optional: options?.optional }),
};

export interface ValidationIssue {
  path: string;
  message: string;
}

export type SchemaParseResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPath(path: string, key?: string | number): string {
  if (key === undefined) {
    return path;
  }
  return typeof key === 'number' ? `${path}[${key}]` : `${path}.${key}`;
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Validates `input` against a schema built with `t`.
 *
 * The schemas used to be documentation only, so every service re-implemented
 * its own `if (!field)` checks and the contract silently drifted from the
 * implementation. This makes the shared schemas executable.
 *
 * Unknown keys are left untouched to keep existing payloads working; only the
 * declared properties are validated.
 */
export function parseSchema<T>(schema: unknown, input: unknown, path = '$'): SchemaParseResult<T> {
  const issues: ValidationIssue[] = [];
  const collect = (node: unknown, value: unknown, currentPath: string) => {
    if (!isPlainObject(node)) {
      return;
    }

    const type = node.type;
    const optional = node.optional === true;

    if (value === undefined || value === null) {
      if (!optional) {
        issues.push({ path: currentPath, message: 'is required' });
      }
      return;
    }

    switch (type) {
      case 'object': {
        if (!isPlainObject(value)) {
          issues.push({ path: currentPath, message: `expected object, received ${typeName(value)}` });
          return;
        }
        for (const [key, child] of Object.entries(node.properties ?? {})) {
          collect(child, value[key], formatPath(currentPath, key));
        }
        return;
      }
      case 'array': {
        if (!Array.isArray(value)) {
          issues.push({ path: currentPath, message: `expected array, received ${typeName(value)}` });
          return;
        }
        value.forEach((item, index) => collect(node.items, item, formatPath(currentPath, index)));
        return;
      }
      case 'string': {
        if (typeof value !== 'string') {
          issues.push({ path: currentPath, message: `expected string, received ${typeName(value)}` });
          return;
        }
        if (typeof node.minLength === 'number' && value.length < node.minLength) {
          issues.push({
            path: currentPath,
            message: `must be at least ${node.minLength} character(s)`,
          });
        }
        if (typeof node.maxLength === 'number' && value.length > node.maxLength) {
          issues.push({
            path: currentPath,
            message: `must be at most ${node.maxLength} character(s)`,
          });
        }
        return;
      }
      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          issues.push({ path: currentPath, message: `expected number, received ${typeName(value)}` });
        }
        return;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          issues.push({ path: currentPath, message: `expected boolean, received ${typeName(value)}` });
        }
        return;
      }
      case 'file':
        // Uploaded files are validated by the multipart handler.
        return;
      default:
        return;
    }
  };

  collect(schema, input, path);

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return { success: true, data: input as T };
}

/** First validation issue, formatted for an error response. */
export function describeIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) {
    return 'Invalid request';
  }

  return issues.map((issue) => `${issue.path} ${issue.message}`).join('; ');
}
