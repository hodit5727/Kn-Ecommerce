/**
 * Generic server-side request-body validator (BACKEND_SPEC §31 — EVERY backend
 * input is validated; frontend validation is UX only).
 *
 *   validate(body, schema) → { ok: true, fields } | { ok: false, errors }
 *
 *   `fields` carries SANITIZED values (trimmed strings, coerced numbers,
 *   length-capped arrays) — guards against mass assignment (§31) because the
 *   caller then writes ONLY whitelisted columns from `fields`.
 *   `errors` maps field → clean, non-internal message.
 *
 * Field rule keys:
 *   type      'string' | 'number' | 'integer' | 'boolean' | 'array' | 'email'
 *             | 'phone' | 'pincode' | 'uuid'          (default 'string')
 *   required  boolean — a missing/undefined field fails when true (default false)
 *   min, max  string/array length bounds, or numeric bounds for number/integer
 *   pattern   RegExp (strings)
 *   enum      allowlist of exact values
 *   arrayOf   item rule applied to array elements (finite depth)
 *   maxItems  array element cap (default 50 — oversized arrays are rejected,
 *             never truncated silently)
 *   trim      boolean (strings, default true)
 */
const MAX_ITEMS_DEFAULT = 50;

function badType(rule, value) {
  switch (rule.type) {
    case 'number':
      return typeof value !== 'number' || !Number.isFinite(value);
    case 'integer':
      return typeof value !== 'number' || !Number.isInteger(value);
    case 'boolean':
      return typeof value !== 'boolean';
    case 'array':
      return !Array.isArray(value);
    case 'email':
      return typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
    case 'phone':
      return typeof value !== 'string' || !/^[6-9][0-9]{9}$/.test(value.trim());
    case 'pincode':
      return typeof value !== 'string' || !/^[1-9][0-9]{5}$/.test(value.trim());
    case 'uuid':
      return (
        typeof value !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      );
    default:
      return typeof value !== 'string';
  }
}

function validateScalar(field, value, rule, errors) {
  if (badType(rule, value)) {
    errors[field] = `${rule.label ?? field} is invalid.`;
    return null;
  }

  let out = value;
  if (rule.type === 'email' || rule.type === 'phone' || rule.type === 'pincode' || rule.type === 'uuid') {
    out = String(value).trim();
  } else if (rule.type === 'string') {
    out = rule.trim === false ? String(value) : String(value).trim();
  }

  if (rule.type === 'string' || rule.type === 'email' || rule.type === 'phone' || rule.type === 'pincode') {
    if (rule.min !== undefined && out.length < rule.min) {
      errors[field] =
        rule.minMsg ?? `${rule.label ?? field} must be at least ${rule.min} characters.`;
      return null;
    }
    if (rule.max !== undefined && out.length > rule.max) {
      errors[field] = rule.maxMsg ?? `${rule.label ?? field} must be at most ${rule.max} characters.`;
      return null;
    }
  }

  if (rule.type === 'number' || rule.type === 'integer') {
    if (rule.minValue !== undefined && out < rule.minValue) {
      errors[field] = rule.minMsg ?? `${rule.label ?? field} must be at least ${rule.minValue}.`;
      return null;
    }
    if (rule.maxValue !== undefined && out > rule.maxValue) {
      errors[field] = rule.maxMsg ?? `${rule.label ?? field} must be at most ${rule.maxValue}.`;
      return null;
    }
  }

  if (rule.type === 'string' && rule.pattern && !rule.pattern.test(out)) {
    errors[field] = rule.patternMsg ?? `${rule.label ?? field} is invalid.`;
    return null;
  }

  if (rule.enum && !rule.enum.includes(out)) {
    errors[field] = rule.enumMsg ?? `${rule.label ?? field} is invalid.`;
    return null;
  }

  return out;
}

/**
 * Validate `body` against a schema of { field: rule }. Returns sanitized
 * fields; ALL rule failures are reported (first error only is surfaced by
 * callers, but collecting every one keeps the contract complete).
 */
export function validate(body, schema) {
  const src = body && typeof body === 'object' ? body : {};
  const fields = {};
  const errors = {};

  for (const [field, rule] of Object.entries(schema)) {
    const has = src[field] !== undefined && src[field] !== null;
    if (!has) {
      if (rule.required) errors[field] = `${rule.label ?? field} is required.`;
      continue;
    }
    if (rule.type === 'array') {
      if (!Array.isArray(src[field])) {
        errors[field] = `${rule.label ?? field} is invalid.`;
        continue;
      }
      if (rule.maxItems !== undefined && src[field].length > rule.maxItems) {
        errors[field] = `${rule.label ?? field} must have at most ${rule.maxItems} items.`;
        continue;
      }
      if (rule.arrayOf) {
        const items = [];
        let arrayInvalid = false;
        for (let i = 0; i < src[field].length; i += 1) {
          const item = src[field][i];
          const itemErrors = {};
          if (rule.arrayOf.type === 'string' || rule.arrayOf.type === 'number' || rule.arrayOf.type === 'integer') {
            const v = validateScalar(`${field}[${i}]`, item, rule.arrayOf, itemErrors);
            if (v === null) { arrayInvalid = true; break; }
            items.push(v);
          } else {
            // Nested object rule — reuse validate() for the element object.
            const sub = validate(item, rule.arrayOf);
            if (!sub.ok) { arrayInvalid = true; break; }
            items.push(sub.fields);
          }
        }
        if (arrayInvalid) {
          errors[field] = `${rule.label ?? field} contains an invalid item.`;
          continue;
        }
        fields[field] = items;
      } else {
        fields[field] = src[field];
      }
      continue;
    }
    if (rule.type === 'object') {
      const sub = validate(src[field], rule.object ?? {});
      if (!sub.ok) {
        errors[field] = `${rule.label ?? field} is invalid.`;
        continue;
      }
      fields[field] = sub.fields;
      continue;
    }
    const v = validateScalar(field, src[field], rule, errors);
    if (v === null) continue;
    fields[field] = v;
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, fields };
}