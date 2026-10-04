/**
 * Shared customer-onboarding validation.
 *
 * Framework-agnostic on purpose: the frontend runs it before submit and the
 * Express backend runs the SAME rules server-side (never trust the client).
 * No secrets, no data access, no side effects.
 */

import {
  CATEGORY_CONFIG,
  GENDER_OPTIONS,
  STAFF_CODE_RULE,
  type Gender,
} from '../config/academicConfig';
import type { UserCategory, UserType } from '../types/auth';

export interface ProfileInput {
  fullName: string;
  gender: Gender | '';
  phone: string;
  email: string;
  category: UserCategory | '';
  userType: UserType | '';
  department: string;
  year: string;
  registrationNumber: string;
  staffCode: string;
}

export type ProfileErrors = Partial<Record<keyof ProfileInput, string>>;

/** Indian mobile: exactly 10 digits, first digit 6–9, no letters. */
export function isValidPhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function isValidFullName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 3 && /^[A-Za-z\s.'-]+$/.test(trimmed);
}

export function digitsOnly(value: string): boolean {
  return /^\d*$/.test(value);
}

function isUserCategory(value: string): value is UserCategory {
  return value === 'ENGINEERING' || value === 'POLYTECHNIC' || value === 'BED';
}

/** Returns an error message for a single field, or undefined when valid. */
export function validateProfileField(
  field: keyof ProfileInput,
  value: string,
  input: ProfileInput,
): string | undefined {
  const v = value.trim();

  switch (field) {
    case 'fullName':
      if (!v) return 'Full name is required.';
      if (!isValidFullName(v)) return 'Enter a valid full name (letters only).';
      return undefined;

    case 'gender':
      if (!v) return 'Please select your gender.';
      if (!(GENDER_OPTIONS as readonly string[]).includes(v)) return 'Invalid gender selection.';
      return undefined;

    case 'phone':
      if (!v) return 'Phone number is required.';
      if (!isValidPhone(v)) return 'Enter a valid 10-digit Indian mobile number.';
      return undefined;

    case 'email':
      if (!v) return 'Email address is required.';
      if (!isValidEmail(v)) return 'Enter a valid email address.';
      return undefined;

    case 'category':
      if (!v) return 'Please select your category.';
      if (!isUserCategory(v)) return 'Invalid category.';
      return undefined;

    case 'userType':
      if (!v) return 'Please select Student or Staff.';
      if (v !== 'STUDENT' && v !== 'STAFF') return 'Invalid user type.';
      return undefined;

    case 'department': {
      if (!input.category || !input.userType) return undefined;
      const allowed = CATEGORY_CONFIG[input.category].departments;
      if (!v) return 'Please select your department.';
      if (!allowed.includes(v)) {
        return `Department is not valid for ${CATEGORY_CONFIG[input.category].label}.`;
      }
      return undefined;
    }

    case 'year': {
      // Staff must never submit a year.
      if (input.userType === 'STAFF') return undefined;
      if (!input.category || !input.userType) return undefined;
      const allowed = CATEGORY_CONFIG[input.category].studentYears;
      if (!v) return 'Please select your year.';
      if (!allowed.includes(v)) return 'Invalid year for the selected category.';
      return undefined;
    }

    case 'registrationNumber': {
      if (input.userType === 'STAFF') return undefined;
      if (!input.category || !input.userType) return undefined;
      const rule = CATEGORY_CONFIG[input.category].registrationNumber;
      if (!v) return 'Registration number is required.';
      if (!digitsOnly(v)) return 'Registration number must contain numbers only.';
      if (v.length !== rule.length) return rule.message;
      return undefined;
    }

    case 'staffCode': {
      if (input.userType !== 'STAFF') return undefined;
      if (!v) return 'Staff code is required.';
      if (!STAFF_CODE_RULE.pattern.test(v)) return STAFF_CODE_RULE.message;
      return undefined;
    }

    default:
      return undefined;
  }
}

/** Validates the whole profile. Returns {} when every field is valid. */
export function validateProfile(input: ProfileInput): ProfileErrors {
  const errors: ProfileErrors = {};
  const fields: Array<keyof ProfileInput> = [
    'fullName',
    'gender',
    'phone',
    'email',
    'category',
    'userType',
    'department',
    'year',
    'registrationNumber',
    'staffCode',
  ];

  for (const field of fields) {
    const message = validateProfileField(field, input[field], input);
    if (message) errors[field] = message;
  }

  return errors;
}
