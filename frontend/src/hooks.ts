import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './services/api';
import type { Plan, TenantRow, Usage, AdminStats, AIModelConfig, Invoice, PaymentChannel, Analytics, Contact, ChatMsg, CheckResult, Broadcast, BroadcastRecipient, WAGroup, LabelInfo, ScheduledMessage, AutoReply, Template, SavedContact, SavedContactsResp, FollowUp, Agent, KnowledgeItem, Handoff } from './types';

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

export function useAdminAIModel() {
  return useQuery<AIModelConfig>({
    queryKey: ['admin', 'ai-model'],
    queryFn: async () => (await api.get('/admin/ai-model')).data,
  });
}

export function useSetAdminAIModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (preset: string) => (await api.put('/admin/ai-model', { preset })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'ai-model'] }),
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
  return useQuery<{ data: ChatMsg[]; needs_human: boolean; media_token: string }>({
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['conversation', agentId] }); qc.invalidateQueries({ queryKey: ['contacts', agentId] }); },
  });
}


export function useRevokeMessage(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ msgId, to }: { msgId: string; to: string }) =>
      (await api.delete('/agents/' + agentId + '/messages/' + msgId, { data: { to } })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', agentId] });
    },
  });
}

export function useSendTyping(agentId: number) {
  return useMutation({
    mutationFn: async ({ to, active }: { to: string; active: boolean }) =>
      (await api.post(`/agents/${agentId}/typing`, { to, active })).data,
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
      (await api.post(`/agents/${agentId}/check-numbers`, { numbers })).data as CheckResult,
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

// ---- Template pesan (quick reply) ----

export function useTemplates(agentId: number) {
  return useQuery<Template[]>({
    queryKey: ['templates', agentId],
    queryFn: async () => (await api.get(`/agents/${agentId}/templates`)).data.data,
    enabled: !!agentId,
  });
}

export function useSaveTemplate(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Partial<Template>) =>
      t.id
        ? (await api.put(`/agents/${agentId}/templates/${t.id}`, t)).data
        : (await api.post(`/agents/${agentId}/templates`, t)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', agentId] }),
  });
}

export function useDeleteTemplate(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tid: number) => (await api.delete(`/agents/${agentId}/templates/${tid}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', agentId] }),
  });
}

// ---- Kontak (CRM ringan) ----

export function useCrmContacts(agentId: number, q: string, tag: string, page: number) {
  return useQuery<SavedContactsResp>({
    queryKey: ['crm-contacts', agentId, q, tag, page],
    queryFn: async () => (await api.get(`/agents/${agentId}/crm/contacts`, { params: { q, tag, page } })).data,
    enabled: !!agentId,
  });
}

export function useSaveCrmContact(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ct: Partial<SavedContact>) =>
      ct.id
        ? (await api.put(`/agents/${agentId}/crm/contacts/${ct.id}`, ct)).data
        : (await api.post(`/agents/${agentId}/crm/contacts`, ct)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-contacts', agentId] }),
  });
}

export function useDeleteCrmContact(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cid: number) => (await api.delete(`/agents/${agentId}/crm/contacts/${cid}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm-contacts', agentId] }),
  });
}

// useCrmContactsExport mengambil SEMUA kontak hasil filter (tanpa paginasi),
// dipakai untuk menjadikan satu tag jadi target broadcast.
export function useCrmContactsExport(agentId: number) {
  return useMutation({
    mutationFn: async ({ q, tag }: { q: string; tag: string }) =>
      (await api.get(`/agents/${agentId}/crm/contacts`, { params: { q, tag, all: 1 } })).data.data as SavedContact[],
  });
}

// ---- Follow-up (drip) ----

export function useFollowUps(agentId: number) {
  return useQuery<FollowUp[]>({
    queryKey: ['follow-ups', agentId],
    queryFn: async () => (await api.get(`/agents/${agentId}/follow-ups`)).data.data,
    enabled: !!agentId,
  });
}

export function useSaveFollowUp(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fu: Partial<FollowUp>) =>
      fu.id
        ? (await api.put(`/agents/${agentId}/follow-ups/${fu.id}`, fu)).data
        : (await api.post(`/agents/${agentId}/follow-ups`, fu)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-ups', agentId] }),
  });
}

export function useDeleteFollowUp(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fid: number) => (await api.delete(`/agents/${agentId}/follow-ups/${fid}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-ups', agentId] }),
  });
}

export function useEnrollFollowUp(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ fid, recipients }: { fid: number; recipients: { number: string; name: string }[] }) =>
      (await api.post(`/agents/${agentId}/follow-ups/${fid}/enroll`, { recipients })).data as { added: number; skipped: number },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['follow-ups', agentId] }),
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

// ---- Agent list & detail (Dashboard) ----

export function useAgents() {
  return useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: async () => (await api.get('/agents')).data.data,
    staleTime: 30_000,
  });
}

export function useAgentStatuses() {
  return useQuery<Record<string, string>>({
    queryKey: ['agent-statuses'],
    queryFn: async () => (await api.get('/agents-status')).data.data,
    refetchInterval: 4000,
  });
}

export function useAgentStatus(agentId: number) {
  return useQuery<{ status: string; qr: string; qr_ttl: number; number: string; name: string }>({
    queryKey: ['agent', agentId, 'status'],
    queryFn: async () => (await api.get(`/agents/${agentId}/wa/status`)).data,
    enabled: !!agentId,
    refetchInterval: 4000,
  });
}

export function useAgentHistory(agentId: number) {
  return useQuery<unknown[]>({
    queryKey: ['agent', agentId, 'history'],
    queryFn: async () => (await api.get(`/agents/${agentId}/chat-history`)).data.data,
    enabled: !!agentId,
    refetchInterval: 4000,
  });
}

export function useAgentKnowledge(agentId: number) {
  return useQuery<KnowledgeItem[]>({
    queryKey: ['agent', agentId, 'knowledge'],
    queryFn: async () => (await api.get(`/agents/${agentId}/knowledge`)).data.data,
    enabled: !!agentId,
    refetchInterval: 4000,
  });
}

export function useAgentHandoffs(agentId: number) {
  return useQuery<Handoff[]>({
    queryKey: ['agent', agentId, 'handoffs'],
    queryFn: async () => (await api.get(`/agents/${agentId}/handoffs`)).data.data,
    enabled: !!agentId,
    refetchInterval: 4000,
  });
}

// ---- Mutasi agent (Dashboard) ----

export function useSaveAgent(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await api.put(`/agents/${agentId}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      qc.invalidateQueries({ queryKey: ['agent', agentId] });
    },
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name: string; tone: string }) =>
      (await api.post('/agents', body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/agents/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useAgentConnect(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/agents/${agentId}/wa/connect`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', agentId, 'status'] }),
  });
}

export function useAgentDisconnect(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.post(`/agents/${agentId}/wa/logout`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', agentId, 'status'] }),
  });
}

export function useAddKnowledge(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { question: string; answer: string; tags: string }) =>
      (await api.post(`/agents/${agentId}/knowledge`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', agentId, 'knowledge'] }),
  });
}

export function useDeleteKnowledge(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/agents/${agentId}/knowledge/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', agentId, 'knowledge'] }),
  });
}

export function useGenerateKnowledge(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { text: string; count: number; biz_type?: string }) =>
      (await api.post(`/agents/${agentId}/knowledge/generate`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', agentId, 'knowledge'] }),
  });
}

export function useResumeHandoff(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sender: string) => (await api.delete(`/agents/${agentId}/handoffs/${sender}`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', agentId, 'handoffs'] });
      qc.invalidateQueries({ queryKey: ['conversation', agentId] });
      qc.invalidateQueries({ queryKey: ['contacts', agentId] });
    },
  });
}

export function useTestChat(agentId: number) {
  return useMutation({
    mutationFn: async (message: string) =>
      (await api.post(`/agents/${agentId}/test-chat`, { message })).data as { reply: string; escalate: boolean; model?: string },
  });
}
