import { Product } from './product';

export interface CartItem {
  id: string;
  product: Product;
  quantity: number;
  selectedColor?: string;
  selectedSize?: string;
  addedAt: string;
}

export interface ShippingAddress {
  id?: string;
  fullName: string;
  phone: string;
  streetAddress: string;
  apartmentSuite?: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
  isDefault?: boolean;
}
