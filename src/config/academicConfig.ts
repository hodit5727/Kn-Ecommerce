/**
 * Academic option configuration — single source of truth for the customer
 * onboarding flow (frontend). The Express backend MUST validate against the
 * same rules (mirrored server-side during the backend phase).
 *
 * Values are taken verbatim from the product spec.
 */
import type { UserCategory, UserType } from '../types/auth';

export const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'] as const;
export type Gender = (typeof GENDER_OPTIONS)[number];

export interface CategoryConfig {
  value: UserCategory;
  label: string;
  description: string;
  /** Allowed department values, stored exactly as written here. */
  departments: readonly string[];
  /** Year options — only applicable for STUDENT. */
  studentYears: readonly string[];
  registrationNumber: {
    /** Digits only, exact digit count. */
    digitsOnly: true;
    length: number;
    message: string;
  };
}

export const CATEGORY_CONFIG: Record<UserCategory, CategoryConfig> = {
  ENGINEERING: {
    value: 'ENGINEERING',
    label: 'Engineering',
    description: 'B.E / B.Tech programs',
    // Spec: Engineering department values are stored in UPPERCASE.
    departments: ['IT', 'CSE', 'C2C', 'EEE', 'ECE', 'BME', 'AGR', 'MECH', 'CIVIL'],
    studentYears: ['I', 'II', 'III', 'IV'],
    registrationNumber: {
      digitsOnly: true,
      length: 12,
      message: 'Registration number must contain exactly 12 digits.',
    },
  },
  POLYTECHNIC: {
    value: 'POLYTECHNIC',
    label: 'Polytechnic',
    description: 'Diploma programs',
    departments: [
      'Civil Engineering',
      'Automobile Engineering',
      'Mech',
      'CSE',
      'ECE',
      'EEE',
    ],
    studentYears: ['I', 'II', 'III'],
    registrationNumber: {
      digitsOnly: true,
      length: 7,
      message: 'Polytechnic registration number must contain exactly 7 digits.',
    },
  },
  BED: {
    value: 'BED',
    label: 'B.Ed',
    description: 'Bachelor of Education',
    departments: ['TAMIL', 'ENGLISH', 'MATHS'],
    studentYears: ['I', 'II'],
    // Spec: "validate according to the configured B.Ed registration-number
    // format". The configured format is 10 digits (matches existing UI).
    registrationNumber: {
      digitsOnly: true,
      length: 10,
      message: 'B.Ed registration number must contain exactly 10 digits.',
    },
  },
};

export const CATEGORY_OPTIONS: ReadonlyArray<{ value: UserCategory; label: string }> = [
  { value: 'ENGINEERING', label: 'Engineering' },
  { value: 'POLYTECHNIC', label: 'Polytechnic' },
  { value: 'BED', label: 'B.Ed' },
];

export const USER_TYPE_OPTIONS: ReadonlyArray<{ value: UserType; label: string }> = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'STAFF', label: 'Staff' },
];

/**
 * Staff code rule — required for every STAFF user.
 * Exact format is product-configurable; default is 4–16 alphanumeric chars.
 */
export const STAFF_CODE_RULE = {
  pattern: /^[A-Za-z0-9]{4,16}$/,
  message: 'Staff code must be 4–16 letters or numbers.',
};

/** Which extra fields a (category, userType) combination requires. */
export function requiredAcademicFields(
  _category: UserCategory,
  userType: UserType,
): ReadonlyArray<'department' | 'year' | 'registrationNumber' | 'staffCode'> {
  if (userType === 'STAFF') {
    // Staff: department + staff code only. No year, no registration number.
    return ['department', 'staffCode'];
  }
  return ['department', 'year', 'registrationNumber'];
}
