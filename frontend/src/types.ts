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
  name?: string;
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

export interface NumberCheck {
  input: string;
  number: string;
  registered: boolean;
}

export interface Broadcast {
  id: number;
  message: string;
  status: string; // pending, running, done, failed, interrupted
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  media_type: string;
  file_name: string;
  created_at: string;
}

export interface BroadcastRecipient {
  id: number;
  number: string;
  name: string;
  status: string; // pending, sent, failed, skipped
  error: string;
  sent_at: string | null;
}

export interface AutoReply {
  id: number;
  keywords: string;
  match_type: string; // contains, exact, prefix
  reply: string;
  enabled: boolean;
  sort_order: number;
}

export interface WAGroup {
  jid: string;
  name: string;
  participants: number;
}

export interface LabelInfo {
  label_id: string;
  name: string;
  color: number;
  count: number;
}

export interface ScheduledMessage {
  id: number;
  run_at: string;
  message: string;
  recipient_count: number;
  media_type: string;
  file_name: string;
  status: string; // scheduled, running, done, failed, cancelled, interrupted
  broadcast_id?: number | null;
}

export function normalizePhone(s: string): string {
  const d = (s.match(/\d/g) || []).join('');
  if (!d) return '';
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
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

export interface Agent {
  id: number;
  name?: string;
  system_prompt?: string;
  tone?: string;
  ai_enabled?: boolean;
  greeting_enabled?: boolean;
  greeting_message?: string;
  business_hours_enabled?: boolean;
  business_start?: string;
  business_end?: string;
  away_message?: string;
}

export interface KnowledgeItem {
  id: number;
  question: string;
  answer: string;
  tags?: string;
}

export interface Handoff {
  id: number;
  sender: string;
  last_msg: string;
}

export function rupiah(n: number): string {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
}
