/**
 * Server-side onboarding validation — the AUTHORITATIVE copy of the rules
 * the frontend also runs (src/lib/validation.ts + src/config/academicConfig.ts).
 * The backend NEVER trusts the client; every field is re-validated here.
 *
 * Mirrored rules (values taken verbatim from the product spec):
 *   gender      Male | Female | Other | Prefer not to say
 *   category    ENGINEERING | POLYTECHNIC | BED
 *   user_type   STUDENT | STAFF
 *   departments per category (exact strings)
 *   years       per category (Roman numerals)
 *   reg number  digits only, exact length (12 / 7 / 10)
 *   staff code  /^[A-Za-z0-9]{4,16}$/
 *   phone       /^[6-9][0-9]{9}$/  (§5-21)
 */

export const GENDER_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];
export const CATEGORY_OPTIONS = ['ENGINEERING', 'POLYTECHNIC', 'BED'];
export const USER_TYPE_OPTIONS = ['STUDENT', 'STAFF'];

export const CATEGORY_RULES = {
  ENGINEERING: {
    departments: ['IT', 'CSE', 'C2C', 'EEE', 'ECE', 'BME', 'AGR', 'MECH', 'CIVIL'],
    studentYears: ['I', 'II', 'III', 'IV'],
    registrationLength: 12,
  },
  POLYTECHNIC: {
    departments: ['Civil Engineering', 'Automobile Engineering', 'Mech', 'CSE', 'ECE', 'EEE'],
    studentYears: ['I', 'II', 'III'],
    registrationLength: 7,
  },
  BED: {
    departments: ['TAMIL', 'ENGLISH', 'MATHS'],
    studentYears: ['I', 'II'],
    registrationLength: 10,
  },
};

export const STAFF_CODE_PATTERN = /^[A-Za-z0-9]{4,16}$/;

export const isValidEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
export const isValidPhone = (v) => typeof v === 'string' && /^[6-9][0-9]{9}$/.test(v.trim());
export const isValidFullName = (v) => {
  const t = String(v ?? '').trim();
  return t.length >= 3 && t.length <= 120 && /^[A-Za-z\s.'-]+$/.test(t);
};
export const isValidPin = (v) => typeof v === 'string' && /^\d{4}$/.test(v);
export const isValidOtp = (v) => typeof v === 'string' && /^\d{6}$/.test(v);

/**
 * Validate the complete OnboardingProfilePayload (POST /auth/profile).
 * @returns {{ ok: true, fields: object } | { ok: false, errors: Record<string,string> }}
 */
export function validateOnboarding(payload) {
  const errors = {};
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: { payload: 'Invalid profile payload.' } };
  }

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  // Email
  if (!isValidEmail(payload.email)) errors.email = 'Enter a valid email address.';

  // Full name
  if (!isValidFullName(payload.fullName)) errors.fullName = 'Enter a valid full name (letters only).';

  // Gender
  const gender = str(payload.gender);
  if (!gender) errors.gender = 'Please select your gender.';
  else if (!GENDER_OPTIONS.includes(gender)) errors.gender = 'Invalid gender selection.';

  // Phone (§5-21)
  const phone = str(payload.phone);
  if (!isValidPhone(phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';

  // Category / user type
  const category = str(payload.category);
  const userType = str(payload.userType);
  if (!CATEGORY_OPTIONS.includes(category)) errors.category = 'Invalid category.';
  if (!USER_TYPE_OPTIONS.includes(userType)) errors.userType = 'Invalid user type.';

  const rules = CATEGORY_RULES[category];

  // Department (must belong to the chosen category)
  const department = str(payload.department);
  if (!rules) {
    errors.department = 'Please select your department.';
  } else if (!rules.departments.includes(department)) {
    errors.department = `Department is not valid for ${category}.`;
  }

  if (userType === 'STAFF') {
    // Staff: department + staff code only. Year and reg number must be null.
    const staffCode = str(payload.staffCode);
    if (!STAFF_CODE_PATTERN.test(staffCode)) {
      errors.staffCode = 'Staff code must be 4-16 letters or numbers.';
    }
    if (payload.year !== null && payload.year !== undefined && payload.year !== '') {
      errors.year = 'Staff must not provide a year.';
    }
    if (payload.registrationNumber !== null && payload.registrationNumber !== undefined && payload.registrationNumber !== '') {
      errors.registrationNumber = 'Staff must not provide a registration number.';
    }
  } else if (userType === 'STUDENT') {
    // Student: year + reg number required; staff code must be null.
    const year = str(payload.year);
    if (!rules) {
      errors.year = 'Please select your year.';
    } else if (!rules.studentYears.includes(year)) {
      errors.year = 'Invalid year for the selected category.';
    }
    const regNo = str(payload.registrationNumber);
    if (!/^\d+$/.test(regNo)) {
      errors.registrationNumber = 'Registration number must contain numbers only.';
    } else if (rules.registrationLength && regNo.length !== rules.registrationLength) {
      errors.registrationNumber =
        category === 'ENGINEERING'
          ? 'Registration number must contain exactly 12 digits.'
          : category === 'POLYTECHNIC'
            ? 'Polytechnic registration number must contain exactly 7 digits.'
            : 'B.Ed registration number must contain exactly 10 digits.';
    } else if (!regNo) {
      errors.registrationNumber = 'Registration number is required.';
    }
    if (payload.staffCode !== null && payload.staffCode !== undefined && payload.staffCode !== '') {
      errors.staffCode = 'A student must not provide a staff code.';
    }
  } else {
    errors.year = 'Please select Student or Staff first.';
    errors.registrationNumber = 'Please select Student or Staff first.';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // Build ONLY the whitelisted DB columns — anything else the client sent is
  // dropped (mass-assignment / §5-31 / §5-76 defence).
  let academicYear = null;
  let collegeRegNo = null;
  let staffCode = null;
  if (userType === 'STUDENT') {
    academicYear = str(payload.year);
    collegeRegNo = str(payload.registrationNumber);
  } else {
    staffCode = str(payload.staffCode);
  }

  return {
    ok: true,
    fields: {
      email: str(payload.email).toLowerCase(),
      full_name: str(payload.fullName),
      gender,
      phone,
      category,
      user_type: userType,
      department,
      academic_year: academicYear,
      college_reg_no: collegeRegNo,
      staff_code: staffCode,
    },
  };
}