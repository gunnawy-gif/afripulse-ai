// Lightweight input validation helpers (no external dependency).

export class ValidationError extends Error {
  public fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super('Validation failed');
    this.fields = fields;
  }
}

export type FieldSpec = {
  required?: boolean;
  max?: number;
  min?: number;
  pattern?: RegExp;
  oneOf?: string[];
  number?: boolean;
  label: string;
};

export function validate(body: Record<string, unknown>, specs: Record<string, FieldSpec>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, spec] of Object.entries(specs)) {
    let value = body[key];
    if (typeof value === 'string') value = value.trim();
    const empty = value === undefined || value === null || value === '';
    if (spec.required && empty) {
      errors[key] = `${spec.label} is required`;
      continue;
    }
    if (empty) continue;
    if (spec.number) {
      const n = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(n)) {
        errors[key] = `${spec.label} must be a number`;
        continue;
      }
      if (spec.min !== undefined && n < spec.min) errors[key] = `${spec.label} must be at least ${spec.min}`;
      if (spec.max !== undefined && n > spec.max) errors[key] = `${spec.label} must be at most ${spec.max}`;
      continue;
    }
    if (typeof value !== 'string') {
      errors[key] = `${spec.label} must be text`;
      continue;
    }
    if (spec.min !== undefined && value.length < spec.min) errors[key] = `${spec.label} must be at least ${spec.min} characters`;
    if (spec.max !== undefined && value.length > spec.max) errors[key] = `${spec.label} must be at most ${spec.max} characters`;
    if (spec.pattern && !spec.pattern.test(value)) errors[key] = `${spec.label} is not in a valid format`;
    if (spec.oneOf && !spec.oneOf.includes(value)) errors[key] = `${spec.label} has an invalid value`;
  }
  return errors;
}

export const CATEGORIES = [
  'infrastructure', 'water_sanitation', 'education', 'healthcare', 'agriculture',
  'security', 'environment', 'unemployment', 'electricity', 'other',
] as const;

export const STATUSES = ['submitted', 'under_review', 'verified', 'assigned', 'in_progress', 'resolved', 'rejected'] as const;
export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const ROLES = ['super_admin', 'lga_admin', 'reviewer', 'analyst'] as const;
export const PUBLIC_ROLES = ['citizen', 'community_rep', 'government'] as const;

export function sanitizeText(value: unknown, max = 5000): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isValidPhone(value: string): boolean {
  return /^\+?[0-9\s\-()]{7,20}$/.test(value);
}
