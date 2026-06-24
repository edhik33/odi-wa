import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Stack, Chip, IconButton, Alert, Checkbox,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, CircularProgress, InputAdornment,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Pagination,
} from '@mui/material';
import EmptyState from './common/EmptyState';
import PeopleIcon from '@mui/icons-material/PeopleOutlined';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import ChatIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CampaignIcon from '@mui/icons-material/CampaignOutlined';
import LocalOfferIcon from '@mui/icons-material/LocalOfferOutlined';
import { useCrmContacts, useSaveCrmContact, useDeleteCrmContact, useCrmContactsExport } from '../hooks';
import api from '../services/api';

const EMPTY: Partial<SavedContact> = { number: '', name: '', notes: '', tags: '' };

export default function ContactsPanel({ agentId, onBroadcast, onOpenChat }: {
  agentId: number;
  onBroadcast: (recipients: string) => void;
  onOpenChat: (number: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<SavedContact | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<SavedContact>>(EMPTY);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkTag, setBulkTag] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  const { data, isLoading } = useCrmContacts(agentId, q, tag, page);
  const saveCrmContact = useSaveCrmContact(agentId);
  const deleteCrmContact = useDeleteCrmContact(agentId);
  const crmExport = useCrmContactsExport(agentId);

  const contacts = data?.data || [];
  const allTags = data?.all_tags || [];

  const openAdd = () => { setForm(EMPTY); setFormErrors({}); setAddOpen(true); };
  const openEdit = (ct: SavedContact) => { setForm(ct); setFormErrors({}); setEdit(ct); setOpen(true); };
  const closeDialog = () => { setAddOpen(false); setOpen(false); setEdit(null); setFormErrors({}); };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.number?.trim()) errs.number = 'Nomor WhatsApp wajib diisi';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    await saveCrmContact.mutateAsync(form);
    closeDialog();
  };

  const remove = async (ct: SavedContact) => {
    if (confirm(`Hapus kontak ${ct.name || ct.number}?`)) await deleteCrmContact.mutateAsync(ct.id);
  };

  const pickTag = (t: string) => { setTag(prev => prev === t ? '' : t); setPage(0); setSelected(new Set()); };

  const handleBroadcast = async () => {
    const list = await crmExport.mutateAsync({ q, tag });
    const lines = list.map((c: any) => `${c.number},${c.name || ''}`);
    onBroadcast(lines.join('\n'));
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === contacts.length && contacts.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(contacts.map(c => c.id)));
    }
  };

  const handleBulkTag = async () => {
    if (!bulkTag.trim() || selected.size === 0) return;
    setBulkApplying(true);
    try {
      await api.post(`/agents/${agentId}/crm/contacts/bulk-tag`, {
        ids: Array.from(selected),
        tag: bulkTag.trim(),
      });
      setSelected(new Set());
      setBulkTag('');
    } catch (e) {
      // handled silently
    } finally {
      setBulkApplying(false);
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ mb: 1.5, gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6">Kontak</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<CampaignIcon />} onClick={handleBroadcast} disabled={contacts.length === 0}>
            {tag ? `Broadcast tag "${tag}"` : 'Broadcast'}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>Tambah</Button>
        </Stack>
      </Stack>

      <TextField
        fullWidth size="small" placeholder="Cari nama atau nomor…"
        value={q} onChange={e => { setQ(e.target.value); setPage(0); setSelected(new Set()); }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        sx={{ mb: 1.5 }}
      />

      {allTags.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}>
            Filter tag
          </Typography>
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
            {allTags.map(t => (
              <Chip key={t} label={t} size="small" color={tag === t ? 'primary' : 'default'}
                variant={tag === t ? 'filled' : 'outlined'} onClick={() => pickTag(t)}
                sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }} />
            ))}
          </Stack>
        </Box>
      )}

      {isLoading ? (
        <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={24} /></Box>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={<PeopleIcon sx={{ fontSize: 48 }} />}
          title={q || tag ? 'Tidak ada kontak' : 'Belum ada kontak'}
          description={q || tag ? 'Coba ubah filter atau kata kunci.' : 'Kontak akan terisi otomatis saat pelanggan chat.'}
        />
      ) : (
        <Paper variant="outlined" sx={{ mb: 1 }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 40, p: 0.5 }}>
                    <Checkbox
                      size="small"
                      checked={contacts.length > 0 && selected.size === contacts.length}
                      indeterminate={selected.size > 0 && selected.size < contacts.length}
                      onChange={toggleSelectAll}
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Nama / Nomor</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Tag</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Terakhir Chat</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 120 }}>Aksi</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {contacts.map(ct => (
                  <TableRow key={ct.id} hover selected={selected.has(ct.id)}>
                    <TableCell sx={{ p: 0.5 }}>
                      <Checkbox size="small" checked={selected.has(ct.id)} onChange={() => toggleSelect(ct.id)} />
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600, fontSize: 13 }}>{ct.name || `+${ct.number}`}</Typography>
                      {ct.name && <Typography variant="caption" color="text.secondary">+{ct.number}</Typography>}
                    </TableCell>
                    <TableCell>
                      {ct.tags ? (
                        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                          {ct.tags.split(',').map(t => t.trim()).filter(Boolean).map((t, i) => (
                            <Chip key={i} label={t} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.disabled">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {ct.last_at ? lastChatLabel(ct.last_at) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <IconButton size="small" onClick={() => onOpenChat(ct.number)}><ChatIcon fontSize="small" /></IconButton>
                        <IconButton size="small" onClick={() => openEdit(ct)}><EditIcon fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => remove(ct)}><DeleteIcon fontSize="small" /></IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {selected.size > 0 && (
        <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, zIndex: 10, borderTop: 1, borderColor: 'divider', borderRadius: 0 }}>
          <Chip label={`${selected.size} terpilih`} size="small" color="primary" onDelete={() => setSelected(new Set())} />
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" size="small" startIcon={<LocalOfferIcon />} onClick={() => setTagModalOpen(true)}>
            Tambah Tag
          </Button>
        </Paper>
      )}

      {contacts.length > 0 && (
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {data?.total ?? 0} kontak
          </Typography>
          <Pagination
            count={Math.ceil((data?.total ?? 0) / (data?.limit ?? 20))}
            page={page + 1}
            onChange={(_e, p) => { setPage(p - 1); setSelected(new Set()); }}
            size="small"
            siblingCount={0}
            boundaryCount={1}
          />
        </Stack>
      )}

      <Dialog open={tagModalOpen} onClose={() => { setTagModalOpen(false); setBulkTag(''); }} maxWidth="xs" fullWidth>
        <DialogTitle>Tambah Tag ke {selected.size} Kontak</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Tag"
              size="small"
              value={bulkTag}
              onChange={e => setBulkTag(e.target.value)}
              placeholder="vip, pelanggan tetap"
              autoFocus
            />
            {allTags.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  Tag yang sudah ada:
                </Typography>
                <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                  {allTags.map(t => (
                    <Chip key={t} label={t} size="small" variant="outlined" onClick={() => setBulkTag(t)}
                      sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }} />
                  ))}
                </Stack>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setTagModalOpen(false); setBulkTag(''); }}>Batal</Button>
          <Button variant="contained" onClick={async () => { await handleBulkTag(); setTagModalOpen(false); }} disabled={!bulkTag.trim() || bulkApplying}>
            {bulkApplying ? '...' : 'Terapkan'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={addOpen || open} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{addOpen ? 'Tambah Kontak' : 'Edit Kontak'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nama" size="small" value={form.name || ''} onChange={e => setForm({...form, name: e.target.value})} />
            <TextField label="Nomor (08xx…)" size="small" value={form.number || ''} onChange={e => setForm({...form, number: e.target.value})} disabled={!!edit} error={!!formErrors.number} helperText={formErrors.number} />
            <TextField label="Tags (pisah koma)" size="small" value={form.tags || ''} onChange={e => setForm({...form, tags: e.target.value})} placeholder="vip, pelanggan tetap" />
            <TextField label="Catatan" size="small" multiline rows={2} value={form.notes || ''} onChange={e => setForm({...form, notes: e.target.value})} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Batal</Button>
          <Button variant="contained" onClick={save} disabled={saveCrmContact.isPending}>Simpan</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function lastChatLabel(d: string | undefined | null): string {
  if (!d) return '';
  const now = Date.now();
  const then = new Date(d).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(d).toLocaleDateString('id-ID');
}
