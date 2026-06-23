import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './services/api';
import type { Plan, TenantRow, Usage, AdminStats, Invoice, PaymentChannel, Analytics, Contact, ChatMsg, NumberCheck, Broadcast, BroadcastRecipient, WAGroup, LabelInfo, ScheduledMessage, AutoReply } from './types';

type ContactList = { number: string; name: string }[];

// ---- Tenant ----

export function useUsage() {
  return useQuery<Usage>({
    queryKey: ['usage'],
    queryFn: async () => (await api.get('/usage')).data,
  });
}

export function usePublicPlans() {
  return useQuery<Plan[]>({
    queryKey: ['public-plans'],
    queryFn: async () => (await api.get('/plans')).data.data,
  });
}

// ---- Billing (Tripay) ----

export function useBillingChannels() {
  return useQuery<PaymentChannel[]>({
    queryKey: ['billing', 'channels'],
    queryFn: async () => (await api.get('/billing/channels')).data.data,
    staleTime: 5 * 60_000,
    retry: false, // kalau Tripay belum dikonfigurasi, jangan retry
  });
}

export function useInvoices() {
  return useQuery<Invoice[]>({
    queryKey: ['billing', 'invoices'],
    queryFn: async () => (await api.get('/billing/invoices')).data.data,
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: async (body: { plan_id: number; method: string }) =>
      (await api.post('/billing/checkout', body)).data.data as { checkout_url: string },
  });
}

// ---- Admin ----

export function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => (await api.get('/admin/stats')).data,
  });
}

export function useAdminTenants() {
  return useQuery<TenantRow[]>({
    queryKey: ['admin', 'tenants'],
    queryFn: async () => (await api.get('/admin/tenants')).data.data,
  });
}

export function useAdminPlans() {
  return useQuery<Plan[]>({
    queryKey: ['admin', 'plans'],
    queryFn: async () => (await api.get('/admin/plans')).data.data,
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<{ status: string; plan_id: number }> }) =>
      (await api.put(`/admin/tenants/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
  });
}

export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plan: Partial<Plan>) =>
      plan.id
        ? (await api.put(`/admin/plans/${plan.id}`, plan)).data
        : (await api.post('/admin/plans', plan)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'plans'] }),
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/admin/plans/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'plans'] }),
  });
}

// ---- Fitur: analitik, inbox, test chat ----

export function useAgentAnalytics(agentId: number) {
  return useQuery<Analytics>({
    queryKey: ['analytics', agentId],
    queryFn: async () => (await api.get(`/agents/${agentId}/analytics`)).data,
    enabled: !!agentId,
  });
}

export function useContacts(agentId: number) {
  return useQuery<Contact[]>({
    queryKey: ['contacts', agentId],
    queryFn: async () => (await api.get(`/agents/${agentId}/contacts`)).data.data,
    enabled: !!agentId,
    refetchInterval: 5000,
  });
}

export function useConversation(agentId: number, sender: string) {
  return useQuery<{ data: ChatMsg[]; needs_human: boolean }>({
    queryKey: ['conversation', agentId, sender],
    queryFn: async () => (await api.get(`/agents/${agentId}/conversation`, { params: { sender } })).data,
    enabled: !!agentId && !!sender,
    refetchInterval: 4000,
  });
}

export function useSendMessage(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { to: string; message: string }) =>
      (await api.post(`/agents/${agentId}/send`, body)).data,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['conversation', agentId, vars.to] });
      qc.invalidateQueries({ queryKey: ['contacts', agentId] });
    },
  });
}

export function useSendMedia(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ to, file, caption }: { to: string; file: File; caption: string }) => {
      const fd = new FormData();
      fd.append('to', to);
      fd.append('caption', caption);
      fd.append('file', file);
      return (await api.post(`/agents/${agentId}/send-media`, fd)).data;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['conversation', agentId, vars.to] });
      qc.invalidateQueries({ queryKey: ['contacts', agentId] });
    },
  });
}

export function useResumeBot(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sender: string) => (await api.delete(`/agents/${agentId}/handoffs/${sender}`)).data,
    onSuccess: (_d, sender) => {
      qc.invalidateQueries({ queryKey: ['conversation', agentId, sender] });
      qc.invalidateQueries({ queryKey: ['contacts', agentId] });
    },
  });
}

// ---- Broadcast ----

export function useCheckNumbers(agentId: number) {
  return useMutation({
    mutationFn: async (numbers: string[]) =>
      (await api.post(`/agents/${agentId}/check-numbers`, { numbers })).data.data as NumberCheck[],
  });
}

export function useBroadcasts(agentId: number, page: number) {
  return useQuery<{ data: Broadcast[]; total: number; page: number; limit: number }>({
    queryKey: ['broadcasts', agentId, page],
    queryFn: async () => (await api.get(`/agents/${agentId}/broadcasts`, { params: { page } })).data,
    enabled: !!agentId,
    refetchInterval: 4000,
  });
}

export function useChatContacts(agentId: number) {
  return useMutation({
    mutationFn: async () => (await api.get(`/agents/${agentId}/chat-contacts`)).data.data as { number: string; name: string }[],
  });
}

export function useWAContacts(agentId: number) {
  return useMutation({
    mutationFn: async () => (await api.get(`/agents/${agentId}/wa-contacts`)).data.data as ContactList,
  });
}

export function useGroups(agentId: number) {
  return useMutation({ mutationFn: async () => (await api.get(`/agents/${agentId}/groups`)).data.data as WAGroup[] });
}

export function useGroupMembers(agentId: number) {
  return useMutation({ mutationFn: async (jid: string) => (await api.get(`/agents/${agentId}/group-members`, { params: { jid } })).data.data as ContactList });
}

export function useLabels(agentId: number) {
  return useMutation({ mutationFn: async () => (await api.get(`/agents/${agentId}/labels`)).data.data as LabelInfo[] });
}

export function useLabelContacts(agentId: number) {
  return useMutation({ mutationFn: async (labelId: string) => (await api.get(`/agents/${agentId}/label-contacts`, { params: { label_id: labelId } })).data.data as ContactList });
}

// ---- Auto-reply (kata kunci) ----

export function useAutoReplies(agentId: number) {
  return useQuery<AutoReply[]>({
    queryKey: ['autoreplies', agentId],
    queryFn: async () => (await api.get(`/agents/${agentId}/auto-replies`)).data.data,
    enabled: !!agentId,
  });
}

export function useSaveAutoReply(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: Partial<AutoReply>) =>
      r.id
        ? (await api.put(`/agents/${agentId}/auto-replies/${r.id}`, r)).data
        : (await api.post(`/agents/${agentId}/auto-replies`, r)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autoreplies', agentId] }),
  });
}

export function useDeleteAutoReply(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rid: number) => (await api.delete(`/agents/${agentId}/auto-replies/${rid}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['autoreplies', agentId] }),
  });
}

// ---- Jadwal (kalender) ----

export function useSchedules(agentId: number) {
  return useQuery<ScheduledMessage[]>({
    queryKey: ['schedules', agentId],
    queryFn: async () => (await api.get(`/agents/${agentId}/schedules`)).data.data,
    enabled: !!agentId,
    refetchInterval: 10000,
  });
}

export function useCreateSchedule(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fd: FormData) => (await api.post(`/agents/${agentId}/schedule`, fd)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules', agentId] }),
  });
}

export function useCancelSchedule(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sid: number) => (await api.delete(`/agents/${agentId}/schedule/${sid}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules', agentId] }),
  });
}

export function useBroadcastDetail(agentId: number, bid: number | null) {
  return useQuery<{ broadcast: Broadcast; recipients: BroadcastRecipient[] }>({
    queryKey: ['broadcast', agentId, bid],
    queryFn: async () => (await api.get(`/agents/${agentId}/broadcasts/${bid}`)).data.data,
    enabled: !!agentId && !!bid,
    refetchInterval: 4000,
  });
}

export function useCreateBroadcast(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { message: string; recipients: { number: string; name: string }[]; min_delay: number; max_delay: number; file: File | null }) => {
      const fd = new FormData();
      fd.append('message', body.message);
      fd.append('recipients', JSON.stringify(body.recipients));
      fd.append('min_delay', String(body.min_delay));
      fd.append('max_delay', String(body.max_delay));
      if (body.file) fd.append('file', body.file);
      return (await api.post(`/agents/${agentId}/broadcast`, fd)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcasts', agentId] }),
  });
}

export function useTestChat(agentId: number) {
  return useMutation({
    mutationFn: async (message: string) =>
      (await api.post(`/agents/${agentId}/test-chat`, { message })).data as { reply: string; escalate: boolean },
  });
}
