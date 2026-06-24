import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Stack, Chip, IconButton, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress, InputAdornment,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import ChatIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CampaignIcon from '@mui/icons-material/CampaignOutlined';
import { useCrmContacts, useSaveCrmContact, useDeleteCrmContact, useCrmContactsExport } from '../hooks';
import type { SavedContact } from '../types';
import { swalConfirm, swalAlert } from '../services/swal';
import PageHeader from './PageHeader';

const EMPTY: Partial<SavedContact> = { number: '', name: '', notes: '', tags: '' };

// waktu chat terakhir → teks relatif singkat.
function lastChatLabel(iso: string | null): string {
  if (!iso) return 'Belum pernah chat';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'Chat hari ini';
  if (days === 1) return 'Chat kemarin';
  if (days < 30) return `Chat ${days} hari lalu`;
  return `Chat ${d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })}`;
}

export default function ContactsPanel({ agentId, onBroadcast, onOpenChat }: {
  agentId: number;
  onBroadcast: (recipients: string) => void;
  onOpenChat: (number: string) => void;
}) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useCrmContacts(agentId, q, tag, page);
  const save = useSaveCrmContact(agentId);
  const del = useDeleteCrmContact(agentId);
  const exportContacts = useCrmContactsExport(agentId);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<SavedContact>>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const contacts = data?.data || [];
  const total = data?.total || 0;
  const limit = data?.limit || 20;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const allTags = data?.all_tags || [];

  const openNew = () => { setForm(EMPTY); setErrors({}); setOpen(true); };
  const openEdit = (ct: SavedContact) => { setForm(ct); setErrors({}); setOpen(true); };
  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.id && !form.number?.trim()) e.number = 'Nomor wajib diisi';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const submit = async () => {
    if (!validate()) return;
    try {
      await save.mutateAsync(form);
      setOpen(false);
    } catch (err: any) {
      await swalAlert(err?.response?.data?.error || 'Gagal menyimpan kontak.', 'error');
    }
  };
  const remove = async (ct: SavedContact) => {
    if (await swalConfirm(`Hapus ${ct.name || '+' + ct.number} dari kontak?`)) del.mutate(ct.id);
  };

  const pickTag = (t: string) => { setTag(prev => prev === t ? '' : t); setPage(1); };

  const broadcastFilter = async () => {
    try {
      const list = await exportContacts.mutateAsync({ q, tag });
      if (list.length === 0) { await swalAlert('Tidak ada kontak pada filter ini.', 'info'); return; }
      onBroadcast(list.map(c => (c.name ? `${c.number},${c.name}` : c.number)).join('\n'));
    } catch {
      await swalAlert('Gagal menyiapkan broadcast.', 'error');
    }
  };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <PageHeader title="Kontak"
        subtitle="Buku kontak terpusat untuk nomor ini. Tambahkan catatan & tag agar mudah dikelompokkan, lalu kirim broadcast ke satu tag atau buka chat langsung."
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Tambah Kontak</Button>} />

      <Stack direction="row" sx={{ gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" placeholder="Cari nama atau nomor…" value={q}
          onChange={e => { setQ(e.target.value); setPage(1); }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          sx={{ flex: 1, minWidth: 200 }} />
        <Button size="small" variant="outlined" startIcon={<CampaignIcon />} onClick={broadcastFilter}
          disabled={exportContacts.isPending || total === 0}>
          {tag ? `Broadcast tag "${tag}"` : 'Broadcast hasil ini'}
        </Button>
      </Stack>

      {allTags.length > 0 && (
        <Stack direction="row" sx={{ gap: 0.5, mb: 1.5, flexWrap: 'wrap' }}>
          {allTags.map(t => (
            <Chip key={t} label={t} size="small" color={tag === t ? 'primary' : 'default'}
              variant={tag === t ? 'filled' : 'outlined'} onClick={() => pickTag(t)} />
          ))}
        </Stack>
      )}

      {contacts.length === 0 ? (
        <EmptyState
          icon={<PeopleIcon sx={{ fontSize: 48 }} />}
          title={q || tag ? 'Tidak ada kontak yang cocok' : 'Belum ada kontak'}
          description={q || tag ? 'Tidak ada kontak yang cocok dengan filter.' : 'Kontak akan terisi otomatis saat pelanggan chat, atau kamu bisa tambahkan manual.'}
          action={!q && !tag ? { label: 'Tambah Kontak', onClick: () => setAddOpen(true) } : undefined}
        />
      ) : (
        <Stack spacing={1}>
          {contacts.map(ct => (
            <Card key={ct.id}>
              <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>{ct.name || `+${ct.number}`}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {ct.name ? `+${ct.number} · ` : ''}{lastChatLabel(ct.last_at)}
                    </Typography>
                    {ct.tags && (
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        {ct.tags.split(',').map(t => t.trim()).filter(Boolean).map((t, i) => (
                          <Chip key={i} label={t} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                        ))}
                      </Stack>
                    )}
                    {ct.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{ct.notes}</Typography>}
                  </Box>
                  <Stack direction="row" sx={{ alignItems: 'center', flexShrink: 0 }}>
                    <IconButton size="small" title="Buka chat" onClick={() => onOpenChat(ct.number)}><ChatIcon fontSize="small" /></IconButton>
                    <IconButton size="small" title="Edit" onClick={() => openEdit(ct)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" title="Hapus" onClick={() => remove(ct)}><DeleteIcon fontSize="small" /></IconButton>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {totalPages > 1 && (
        <Stack direction="row" sx={{ justifyContent: 'center', alignItems: 'center', gap: 2, mt: 2 }}>
          <Button size="small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</Button>
          <Typography variant="caption">Hal {page} / {totalPages} · {total} kontak</Typography>
          <Button size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Berikutnya</Button>
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{form.id ? 'Edit Kontak' : 'Kontak Baru'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nomor WhatsApp" value={form.number ?? ''} disabled={!!form.id}
              onChange={e => { setForm({ ...form, number: e.target.value }); if (errors.number) setErrors(p => ({ ...p, number: '' })); }}
              size="small" placeholder="08123456789" error={!!errors.number}
              helperText={errors.number || (form.id ? 'Nomor tidak bisa diubah. Hapus & tambah ulang bila salah.' : 'Boleh format 08… atau 62…')} />
            <TextField label="Nama" value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} size="small" />
            <TextField label="Tag (pisah dengan koma)" value={form.tags ?? ''} onChange={e => setForm({ ...form, tags: e.target.value })}
              size="small" placeholder="vip, reseller" helperText="Untuk mengelompokkan kontak (mis. vip, reseller, kota)." />
            <TextField label="Catatan" value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })}
              size="small" multiline rows={3} placeholder="Suka produk A, follow up akhir bulan…" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={submit} disabled={save.isPending}>Simpan</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
