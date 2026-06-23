import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Stack, IconButton, Chip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress, Divider, Alert,
  LinearProgress, Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import { useSchedules, useCreateSchedule, useCancelSchedule, useBroadcastDetail } from '../hooks';
import RecipientField from './RecipientField';
import WhatsAppEditor from './WhatsAppEditor';
import PageHeader from './PageHeader';
import { swalConfirm } from '../services/swal';
import type { ScheduledMessage } from '../types';

const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  scheduled: 'warning', running: 'warning', done: 'success', failed: 'error', cancelled: 'default', interrupted: 'error',
};
const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Terjadwal', running: 'Mengirim...', done: 'Terkirim', failed: 'Gagal', interrupted: 'Tertunda', cancelled: 'Dibatalkan',
};
const RCP_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  sent: 'success', failed: 'error', skipped: 'default', pending: 'warning',
};
const pad = (n: number) => String(n).padStart(2, '0');

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error || fallback;
  }
  return fallback;
}

function dateKeyFromDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortDate(key: string | null) {
  if (!key) return '';
  return new Date(`${key}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

function scheduledTime(s: ScheduledMessage) {
  return new Date(s.run_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export default function CalendarPanel({ agentId }: { agentId: number }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selDate, setSelDate] = useState<string>(dateKeyFromDate(today));
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const { data: schedules } = useSchedules(agentId);
  const createSchedule = useCreateSchedule(agentId);
  const cancelSchedule = useCancelSchedule(agentId);
  const { data: detail } = useBroadcastDetail(agentId, detailId);

  const [time, setTime] = useState('09:00');
  const [message, setMessage] = useState('');
  const [recipients, setRecipients] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [minDelay, setMinDelay] = useState(10);
  const [maxDelay, setMaxDelay] = useState(30);
  const [err, setErr] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const byDate: Record<string, ScheduledMessage[]> = {};
  (schedules || []).forEach(s => {
    const key = dateKeyFromDate(new Date(s.run_at));
    (byDate[key] ||= []).push(s);
  });
  Object.values(byDate).forEach(list => {
    list.sort((a, b) => new Date(a.run_at).getTime() - new Date(b.run_at).getTime());
  });

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const dateKey = (day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
  const isToday = (day: number) => dateKey(day) === dateKeyFromDate(today);
  const daySchedules = byDate[selDate] || [];
  const activeCount = daySchedules.filter(s => s.status === 'scheduled' || s.status === 'running').length;

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1);
  };

  const resetForm = () => {
    setTime('09:00');
    setMessage('');
    setRecipients('');
    setFile(null);
    setErr('');
    setErrors({});
    setMinDelay(10);
    setMaxDelay(30);
  };

  const openCreate = (key = selDate) => {
    setSelDate(key);
    resetForm();
    setFormOpen(true);
  };

  const cancel = async (s: ScheduledMessage) => {
    const ok = await swalConfirm('Batalkan jadwal ini?', `${scheduledTime(s)} - ${s.recipient_count} nomor`);
    if (ok) await cancelSchedule.mutateAsync(s.id);
  };

  const save = async () => {
    setErr('');
    const e: Record<string, string> = {};
    if (!message.trim()) e.message = 'Pesan wajib diisi';
    const recList = recipients.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const [num, ...rest] = line.split(',');
      return { number: num, name: rest.join(',').trim() };
    });
    if (recList.length === 0) e.recipients = 'Penerima wajib diisi';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const runAt = new Date(`${selDate}T${time}:00`);
    if (runAt.getTime() < Date.now()) {
      setErr('Waktu jadwal sudah lewat');
      return;
    }

    const fd = new FormData();
    fd.append('message', message);
    fd.append('recipients', JSON.stringify(recList));
    fd.append('run_at', runAt.toISOString());
    fd.append('min_delay', String(minDelay));
    fd.append('max_delay', String(maxDelay));
    if (file) fd.append('file', file);
    try {
      await createSchedule.mutateAsync(fd);
      setFormOpen(false);
      resetForm();
    } catch (e) {
      setErr(errorMessage(e, 'Gagal menjadwalkan'));
    }
  };

  const closeDetail = () => setDetailId(null);

  return (
    <Box>
      <PageHeader title="Kalender"
        subtitle="Pilih tanggal untuk melihat jadwal. Jadwal yang sudah berjalan bisa dibuka detail hasil pengirimannya langsung dari sini." />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.1fr) 380px' }, gap: 1.5, alignItems: 'start' }}>
        <Card>
          <CardContent>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <IconButton onClick={prevMonth}><ChevronLeftIcon /></IconButton>
              <Typography sx={{ fontWeight: 700 }}>{MONTHS[month]} {year}</Typography>
              <IconButton onClick={nextMonth}><ChevronRightIcon /></IconButton>
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 0.5, mb: 0.5 }}>
              {DOW.map(d => <Typography key={d} variant="caption" sx={{ textAlign: 'center', fontWeight: 700, color: 'text.secondary' }}>{d}</Typography>)}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 0.5 }}>
              {cells.map((day, i) => day === null ? <Box key={i} /> : (() => {
                const key = dateKey(day);
                const items = byDate[key] || [];
                const selected = key === selDate;
                const failed = items.some(s => s.status === 'failed' || s.status === 'interrupted');
                const done = items.some(s => s.status === 'done');
                return (
                  <Box key={i} onClick={() => setSelDate(key)}
                    sx={{
                      cursor: 'pointer', border: '1px solid', borderColor: selected ? 'primary.main' : 'divider', borderRadius: 1,
                      minHeight: { xs: 52, sm: 64 }, p: 0.75, bgcolor: selected ? 'rgba(31,138,80,0.10)' : isToday(day) ? '#e8f5e9' : '#fff',
                      boxShadow: selected ? 'inset 0 0 0 1px #1F8A50' : 'none',
                      '&:hover': { bgcolor: '#f1f8f4' },
                    }}>
                    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 800 }}>{day}</Typography>
                      {items.length > 0 && <Chip size="small" label={items.length} color={failed ? 'error' : done ? 'success' : 'warning'} sx={{ height: 18, minWidth: 22, fontSize: 11 }} />}
                    </Stack>
                    {items.length > 0 && (
                      <Box sx={{ mt: 0.75, display: 'flex', gap: 0.35, flexWrap: 'wrap' }}>
                        {items.slice(0, 3).map(s => (
                          <Box key={s.id} sx={{
                            width: 7, height: 7, borderRadius: '50%',
                            bgcolor: s.status === 'done' ? 'success.main' : s.status === 'failed' || s.status === 'interrupted' ? 'error.main' : 'warning.main',
                          }} />
                        ))}
                      </Box>
                    )}
                  </Box>
                );
              })())}
            </Box>
          </CardContent>
        </Card>

        <Card sx={{ position: { lg: 'sticky' }, top: { lg: 12 } }}>
          <CardContent>
            <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2">Jadwal Tanggal Ini</Typography>
                <Typography variant="body2" color="text.secondary">{shortDate(selDate)}</Typography>
              </Box>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => openCreate()}>
                Jadwalkan
              </Button>
            </Stack>
            <Stack direction="row" spacing={0.75} sx={{ mb: 1.25, flexWrap: 'wrap', gap: 0.75 }}>
              <Chip size="small" label={`${daySchedules.length} total`} />
              <Chip size="small" label={`${activeCount} aktif`} color={activeCount ? 'warning' : 'default'} />
            </Stack>
            <Divider sx={{ mb: 1 }} />

            {daySchedules.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">Belum ada jadwal di tanggal ini.</Typography>
                <Button sx={{ mt: 1 }} startIcon={<AddIcon />} onClick={() => openCreate()}>Buat Jadwal</Button>
              </Box>
            ) : (
              <Stack spacing={1} sx={{ maxHeight: { xs: 420, lg: 'calc(100vh - 250px)' }, overflowY: 'auto', pr: 0.25 }}>
                {daySchedules.map(s => (
                  <Box key={s.id} sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: '#fff' }}>
                    <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {scheduledTime(s)} · {s.recipient_count} nomor
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.media_type && 'Lampiran · '}{s.message}
                        </Typography>
                      </Box>
                      <Chip size="small" label={STATUS_LABEL[s.status] ?? s.status} color={STATUS_COLOR[s.status] ?? 'default'} />
                    </Stack>
                    <Stack direction="row" spacing={0.75} sx={{ mt: 1, justifyContent: 'flex-end' }}>
                      {s.broadcast_id && (
                        <Button size="small" variant="outlined" startIcon={<VisibilityIcon />} onClick={() => setDetailId(s.broadcast_id || null)}>
                          Lihat Hasil
                        </Button>
                      )}
                      {s.status === 'scheduled' && (
                        <IconButton color="error" onClick={() => cancel(s)} aria-label="Batalkan jadwal">
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Jadwalkan Broadcast · {shortDate(selDate)}</DialogTitle>
        <DialogContent dividers>
          {err && <Alert severity="error" sx={{ mb: 1.5 }}>{err}</Alert>}
          <TextField type="time" label="Jam" size="small" value={time} onChange={e => setTime(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }} sx={{ mb: 1.5 }} />
          <Box sx={{ mb: 1.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Pesan</Typography>
            <WhatsAppEditor value={message} onChange={v => { setMessage(v); if (errors.message) setErrors(p => ({...p, message: ''})); }}
              placeholder="Halo {nama}, ..." rows={3} error={!!errors.message} helperText={errors.message} />
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
            <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />}>
              Lampiran
              <input type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
            </Button>
            {file && <Chip label={file.name} size="small" onDelete={() => setFile(null)} deleteIcon={<CloseIcon />} />}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Penerima</Typography>
          <RecipientField agentId={agentId} value={recipients} onChange={v => { setRecipients(v); if (errors.recipients) setErrors(p => ({...p, recipients: ''})); }} error={errors.recipients} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.25 }}>
            <TextField type="number" size="small" label="Jeda min (dtk)" value={minDelay} onChange={e => setMinDelay(Number(e.target.value))} sx={{ width: { xs: '100%', sm: 132 } }} />
            <TextField type="number" size="small" label="Jeda maks (dtk)" value={maxDelay} onChange={e => setMaxDelay(Number(e.target.value))} sx={{ width: { xs: '100%', sm: 132 } }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)}>Tutup</Button>
          <Button variant="contained" onClick={save} disabled={createSchedule.isPending}
            startIcon={createSchedule.isPending ? <CircularProgress size={16} /> : null}>
            Simpan Jadwal
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!detailId} onClose={closeDetail} fullWidth maxWidth="sm">
        <DialogTitle>Hasil Broadcast</DialogTitle>
        <DialogContent dividers>
          {detail ? (() => {
            const b = detail.broadcast;
            const done = b.sent + b.failed + b.skipped;
            const pct = b.total ? Math.round((done / b.total) * 100) : 0;
            return (
              <>
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                  <Chip label={STATUS_LABEL[b.status] ?? b.status} color={STATUS_COLOR[b.status] ?? 'default'} />
                  <Typography variant="caption" color="text.secondary">
                    {b.sent} terkirim · {b.failed} gagal · {b.skipped} dilewati / {b.total}
                  </Typography>
                </Stack>
                <LinearProgress variant="determinate" value={pct} sx={{ height: 7, borderRadius: 5, mb: 1.5 }} />
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1.5 }}>{b.message}</Typography>
                <Box sx={{ maxHeight: 360, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Nomor</TableCell>
                        <TableCell>Nama</TableCell>
                        <TableCell align="right">Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.recipients.map(r => (
                        <TableRow key={r.id}>
                          <TableCell>+{r.number}</TableCell>
                          <TableCell>{r.name || '-'}</TableCell>
                          <TableCell align="right">
                            <Chip size="small" label={r.status} color={RCP_COLOR[r.status] ?? 'default'} />
                            {r.error && <Typography variant="caption" color="error" sx={{ display: 'block' }}>{r.error}</Typography>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </>
            );
          })() : (
            <Box sx={{ textAlign: 'center', py: 3 }}><CircularProgress /></Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDetail}>Tutup</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
