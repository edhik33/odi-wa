import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Stack, Chip, Switch, IconButton, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Select, MenuItem,
  FormControl, InputLabel, FormControlLabel, CircularProgress, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonAddIcon from '@mui/icons-material/PersonAddAlt1Outlined';
import {
  useFollowUps, useSaveFollowUp, useDeleteFollowUp, useEnrollFollowUp,
  useCrmContacts, useCrmContactsExport,
} from '../hooks';
import type { FollowUp } from '../types';
import { normalizePhone } from '../types';
import { swalConfirm, swalAlert } from '../services/swal';
import PageHeader from './PageHeader';
import EmptyState from './common/EmptyState';
import WhatsAppEditor from './WhatsAppEditor';
import TemplatePicker from './TemplatePicker';
import RecipientField from './RecipientField';

type StepForm = { delay_value: number; delay_unit: 'hari' | 'jam'; message: string };

// jam tersimpan -> {nilai, satuan} untuk editor.
function hoursToParts(h: number): { delay_value: number; delay_unit: 'hari' | 'jam' } {
  if (h > 0 && h % 24 === 0) return { delay_value: h / 24, delay_unit: 'hari' };
  return { delay_value: h, delay_unit: 'jam' };
}
function partsToHours(s: StepForm): number {
  const v = Math.max(0, Math.floor(s.delay_value || 0));
  return s.delay_unit === 'hari' ? v * 24 : v;
}
function stepBadge(h: number): string {
  if (h === 0) return 'langsung';
  if (h % 24 === 0) return `H+${h / 24}`;
  return `+${h}j`;
}

const NEW_STEP: StepForm = { delay_value: 1, delay_unit: 'hari', message: '' };

export default function FollowUpPanel({ agentId }: { agentId: number }) {
  const { data: flows, isLoading } = useFollowUps(agentId);
  const save = useSaveFollowUp(agentId);
  const del = useDeleteFollowUp(agentId);
  const enroll = useEnrollFollowUp(agentId);
  const exportContacts = useCrmContactsExport(agentId);
  const { data: crm } = useCrmContacts(agentId, '', '', 1);
  const allTags = crm?.all_tags || [];

  // ---- form urutan ----
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [stopOnReply, setStopOnReply] = useState(true);
  const [steps, setSteps] = useState<StepForm[]>([{ ...NEW_STEP, delay_value: 0, delay_unit: 'jam' }]);

  const openNew = () => {
    setEditId(null); setName(''); setStopOnReply(true);
    setSteps([{ delay_value: 0, delay_unit: 'jam', message: '' }]);
    setOpen(true);
  };
  const openEdit = (fu: FollowUp) => {
    setEditId(fu.id); setName(fu.name); setStopOnReply(fu.stop_on_reply);
    setSteps(fu.steps.length ? fu.steps.map(s => ({ ...hoursToParts(s.delay_hours), message: s.message })) : [{ delay_value: 0, delay_unit: 'jam', message: '' }]);
    setOpen(true);
  };

  const setStep = (i: number, patch: Partial<StepForm>) => setSteps(steps.map((s, j) => j === i ? { ...s, ...patch } : s));
  const addStep = () => setSteps([...steps, { ...NEW_STEP }]);
  const removeStep = (i: number) => setSteps(steps.filter((_, j) => j !== i));

  const submit = async () => {
    if (!name.trim()) { await swalAlert('Nama urutan wajib diisi.', 'warning'); return; }
    const payloadSteps = steps.filter(s => s.message.trim()).map(s => ({ delay_hours: partsToHours(s), message: s.message }));
    if (payloadSteps.length === 0) { await swalAlert('Minimal satu langkah dengan pesan.', 'warning'); return; }
    await save.mutateAsync({ id: editId ?? undefined, name, stop_on_reply: stopOnReply, steps: payloadSteps } as Partial<FollowUp>);
    setOpen(false);
  };

  const toggle = (fu: FollowUp) => save.mutate({ id: fu.id, enabled: !fu.enabled } as Partial<FollowUp>);
  const remove = async (fu: FollowUp) => { if (await swalConfirm(`Hapus urutan "${fu.name}"?`, 'Pendaftaran kontak pada urutan ini juga dihapus.')) del.mutate(fu.id); };

  // ---- dialog daftarkan kontak ----
  const [enrollFu, setEnrollFu] = useState<FollowUp | null>(null);
  const [recipients, setRecipients] = useState('');
  const [enrollTag, setEnrollTag] = useState('');

  const openEnroll = (fu: FollowUp) => { setEnrollFu(fu); setRecipients(''); setEnrollTag(''); };

  const fillFromTag = async (tag: string) => {
    setEnrollTag(tag);
    if (!tag) return;
    try {
      const list = await exportContacts.mutateAsync({ q: '', tag });
      const lines = list.map(c => (c.name ? `${c.number},${c.name}` : c.number));
      setRecipients(prev => {
        const have = new Set(prev.split('\n').map(l => normalizePhone(l.split(',')[0])).filter(Boolean));
        const fresh = lines.filter(l => !have.has(normalizePhone(l.split(',')[0])));
        return [prev.trim(), ...fresh].filter(Boolean).join('\n');
      });
    } catch { await swalAlert('Gagal mengambil kontak tag.', 'error'); }
  };

  const doEnroll = async () => {
    if (!enrollFu) return;
    const parsed = recipients.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const [num, ...rest] = line.split(',');
      return { number: normalizePhone(num), name: rest.join(',').trim() };
    }).filter(r => r.number);
    if (parsed.length === 0) { await swalAlert('Masukkan minimal satu nomor.', 'warning'); return; }
    const res = await enroll.mutateAsync({ fid: enrollFu.id, recipients: parsed });
    setEnrollFu(null);
    await swalAlert(`${res.added} kontak didaftarkan${res.skipped ? `, ${res.skipped} dilewati (sudah aktif / opt-out)` : ''}.`, 'success');
  };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <PageHeader title="Follow-up"
        subtitle="Urutan pesan susulan otomatis. Daftarkan kontak (dari tag atau nomor), lalu tiap langkah terkirim sesuai jeda. Pakai {nama} untuk personalisasi. Kontak yang membalas atau kirim STOP otomatis berhenti."
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Buat Urutan</Button>} />

      {(!flows || flows.length === 0) ? (
        <EmptyState
          icon={<ScheduleSendIcon sx={{ fontSize: 48 }} />}
          title="Belum ada urutan follow-up"
          description="Jadwalkan pesan otomatis untuk menjaga hubungan dengan pelanggan. Contoh: H+0 ucapan terima kasih, H+3 tips produk."
          actionLabel="Buat Urutan"
          onAction={() => setOpen(true)}
        />
      ) : (
        <Stack spacing={1}>
          {flows.map(fu => (
            <Card key={fu.id} sx={{ opacity: fu.enabled ? 1 : 0.6 }}>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>{fu.name}</Typography>
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, my: 0.75, alignItems: 'center' }}>
                      {fu.steps.map((s, i) => (
                        <Chip key={i} size="small" label={`${stepBadge(s.delay_hours)}`} color="primary" variant="outlined" />
                      ))}
                      <Typography variant="caption" color="text.secondary">· {fu.steps.length} langkah</Typography>
                    </Stack>
                    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                      <Chip size="small" label={`Aktif ${fu.counts.active}`} color={fu.counts.active ? 'success' : 'default'} variant="outlined" />
                      <Chip size="small" label={`Selesai ${fu.counts.completed}`} variant="outlined" />
                      <Chip size="small" label={`Stop ${fu.counts.stopped}`} variant="outlined" />
                      {fu.stop_on_reply && <Typography variant="caption" color="text.secondary">· stop bila dibalas</Typography>}
                    </Stack>
                  </Box>
                  <Stack direction="row" sx={{ alignItems: 'center', flexShrink: 0 }}>
                    <Switch checked={fu.enabled} onChange={() => toggle(fu)} size="small" />
                    <IconButton size="small" title="Daftarkan kontak" color="primary" onClick={() => openEnroll(fu)}><PersonAddIcon fontSize="small" /></IconButton>
                    <IconButton size="small" title="Edit" onClick={() => openEdit(fu)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" title="Hapus" onClick={() => remove(fu)}><DeleteIcon fontSize="small" /></IconButton>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Buat / edit urutan */}
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editId ? 'Edit Urutan' : 'Urutan Baru'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Nama urutan" value={name} onChange={e => setName(e.target.value)} size="small" placeholder="Onboarding pembeli baru" />
            <FormControlLabel control={<Switch checked={stopOnReply} onChange={e => setStopOnReply(e.target.checked)} />}
              label="Berhenti otomatis kalau kontak membalas" />
            <Divider>Langkah</Divider>
            {steps.map((s, i) => (
              <Box key={i} sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>Kirim setelah</Typography>
                  <TextField type="number" size="small" value={s.delay_value}
                    onChange={e => setStep(i, { delay_value: Number(e.target.value) })} sx={{ width: 80 }}
                    slotProps={{ htmlInput: { min: 0 } }} />
                  <FormControl size="small" sx={{ width: 100 }}>
                    <Select value={s.delay_unit} onChange={e => setStep(i, { delay_unit: e.target.value as 'hari' | 'jam' })}>
                      <MenuItem value="jam">jam</MenuItem>
                      <MenuItem value="hari">hari</MenuItem>
                    </Select>
                  </FormControl>
                  <Typography variant="caption" color="text.secondary">sejak didaftarkan</Typography>
                  <Box sx={{ flex: 1 }} />
                  {steps.length > 1 && <IconButton size="small" color="error" onClick={() => removeStep(i)}><DeleteIcon fontSize="small" /></IconButton>}
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 0.5 }}>
                  <TemplatePicker agentId={agentId} variant="text" onPick={b => setStep(i, { message: s.message ? s.message + '\n' + b : b })} />
                </Stack>
                <WhatsAppEditor value={s.message} onChange={v => setStep(i, { message: v })}
                  placeholder="Halo {nama}, gimana kabarnya? ..." rows={3} />
              </Box>
            ))}
            <Button startIcon={<AddIcon />} onClick={addStep} size="small" sx={{ alignSelf: 'flex-start' }}>Tambah langkah</Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={submit} disabled={save.isPending}>Simpan</Button>
        </DialogActions>
      </Dialog>

      {/* Daftarkan kontak */}
      <Dialog open={!!enrollFu} onClose={() => setEnrollFu(null)} fullWidth maxWidth="sm">
        <DialogTitle>Daftarkan ke "{enrollFu?.name}"</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {allTags.length > 0 && (
              <FormControl size="small" fullWidth>
                <InputLabel>Isi dari tag kontak</InputLabel>
                <Select label="Isi dari tag kontak" value={enrollTag} onChange={e => fillFromTag(e.target.value)}>
                  <MenuItem value=""><em>— pilih tag —</em></MenuItem>
                  {allTags.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            <RecipientField agentId={agentId} value={recipients} onChange={setRecipients} />
            <Typography variant="caption" color="text.secondary">
              Nomor yang sudah aktif di urutan ini atau sudah opt-out otomatis dilewati.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEnrollFu(null)}>Batal</Button>
          <Button variant="contained" onClick={doEnroll} disabled={enroll.isPending}>Daftarkan</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
