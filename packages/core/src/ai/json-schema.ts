import { z } from 'zod';

/** Keywords Claude structured outputs reject; the zod schema still enforces them afterwards. */
const UNSUPPORTED = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
  '$schema',
]);

/**
 * The JSON schema sent to the model: generated from the output's zod schema, with every object
 * closed (`additionalProperties: false`) and the unsupported constraints removed.
 */
export function modelJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return clean(z.toJSONSchema(schema, { io: 'input' })) as Record<string, unknown>;
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED.has(key)) continue;
    out[key] = clean(value);
  }
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}
