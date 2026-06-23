// Tipe data SaaS (selaras dengan model backend).

export interface Plan {
  id: number;
  code: string;
  name: string;
  description: string;
  price: number;
  billing_period: string;
  max_numbers: number;
  max_ai_replies_monthly: number;
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
}

export interface Tenant {
  id: number;
  name: string;
  status: 'trial' | 'active' | 'suspended' | 'expired';
  plan_id: number | null;
  plan?: Plan | null;
  trial_ends_at: string | null;
  created_at: string;
}

export interface TenantRow extends Tenant {
  numbers_used: number;
  ai_replies_used: number;
}

export interface Usage {
  tenant: Tenant;
  period: string;
  numbers_used: number;
  max_numbers: number;
  ai_replies_used: number;
  ai_replies_max: number;
}

export interface AdminStats {
  total_tenants: number;
  active_tenants: number;
  trial_tenants: number;
  revenue_total: number;
  ai_replies_month: number;
  period: string;
}

export interface Invoice {
  id: number;
  plan_id: number;
  merchant_ref: string;
  tripay_reference: string;
  amount: number;
  status: string;
  payment_method: string;
  checkout_url: string;
  paid_at: string | null;
  created_at: string;
}

export interface PaymentChannel {
  code: string;
  name: string;
  group?: string;
  icon_url?: string;
  total_fee?: { flat: number; percent: string };
}

export interface ChatMsg {
  id: number;
  sender: string;
  message: string;
  reply: string;
  from_human: boolean;
  media_type: string; // "", image, document, audio, video, sticker
  file_name: string;
  mimetype: string;
  created_at: string;
}

export interface Contact {
  sender: string;
  last_at: string;
  needs_human: boolean;
}

export interface Analytics {
  total_incoming: number;
  ai_replies: number;
  human_replies: number;
  contacts: number;
  open_handoffs: number;
  ai_handled_pct: number;
  trend: { day: string; count: number }[];
}

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
  role: string;
  is_super_admin: boolean;
  tenant_id: number | null;
}

export function currentUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

export function rupiah(n: number): string {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
}
