export type UserRole = 'CUSTOMER' | 'SELLER' | 'ADMIN';

export type SellerStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export type UserCategory = 'ENGINEERING' | 'POLYTECHNIC' | 'BED';

export type UserType = 'STUDENT' | 'STAFF';

export type EngDepartment = 'IT' | 'CSE' | 'C2C' | 'EEE' | 'ECE' | 'BME' | 'AGR' | 'MECH' | 'CIVIL';

export type PolyDepartment =
  | 'Civil Engineering'
  | 'Automobile Engineering'
  | 'Mech'
  | 'CSE'
  | 'ECE'
  | 'EEE';

export type BedDepartment = 'TAMIL' | 'ENGLISH' | 'MATHS';

export type Department = EngDepartment | PolyDepartment | BedDepartment;

export interface UserProfile {
  id: string;
  phone: string;
  email: string;
  fullName: string;
  gender: string;
  avatarUrl?: string;
  role: UserRole;
  roles?: UserRole[];
  isSellerApproved: boolean;
  sellerStatus: SellerStatus;
  sellerStoreName?: string;
  customerId?: string;
  sellerId?: string;
  businessId?: string;
  onboardingComplete: boolean;
  // College profile
  category?: UserCategory;
  userType?: UserType;
  department?: string;
  year?: string;
  registrationNumber?: string;
  staffCode?: string;
  createdAt: string;
}

export interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  activeRole: UserRole;
  token?: string;
}

/**
 * Payload submitted at the final onboarding step ("Complete Profile").
 * The backend MUST re-validate every field and reject invalid combinations
 * (e.g. Engineering + Polytechnic department, Staff + year, wrong digit counts).
 * `null` marks a field that does not apply to the chosen user type.
 */
export interface OnboardingProfilePayload {
  phone: string;
  fullName: string;
  gender: string;
  email: string;
  category: UserCategory;
  userType: UserType;
  department: string;
  year: string | null;
  registrationNumber: string | null;
  staffCode: string | null;
}

export interface CollegeProfile {
  fullName: string;
  gender: string;
  email: string;
  category: UserCategory;
  userType: UserType;
  department: string;
  year?: string;
  registrationNumber?: string;
  staffCode?: string;
}

/**
 * Server-returned reference to an uploaded identity document
 * (POST /seller/documents). The storage path is SERVER-generated; the client
 * only echoes back the metadata the server itself produced.
 */
export interface SellerDocumentReference {
  storagePath: string;
  mimeType: string;
  byteSize: number;
}

export interface SellerApplicationData {
  storeName: string;
  businessType: 'INDIVIDUAL' | 'PROPRIETORSHIP' | 'REGISTERED_COMPANY';
  businessAddress: string;
  storeCategory: string;
  agreeToTerms: boolean;
  /** College ID / identity proof — uploaded first, then referenced here. */
  idDocument?: SellerDocumentReference;
}
