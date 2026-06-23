import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, Stack, IconButton, Chip, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress, Divider, Alert,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import { useSchedules, useCreateSchedule, useCancelSchedule } from '../hooks';
import RecipientField from './RecipientField';
import WhatsAppEditor from './WhatsAppEditor';
import PageHeader from './PageHeader';
import { swalConfirm } from '../services/swal';
import type { ScheduledMessage } from '../types';

const DOW = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  scheduled: 'warning', done: 'success', cancelled: 'default', interrupted: 'error',
};
const pad = (n: number) => String(n).padStart(2, '0');

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error || fallback;
  }
  return fallback;
}

export default function CalendarPanel({ agentId }: { agentId: number }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const { data: schedules } = useSchedules(agentId);
  const createSchedule = useCreateSchedule(agentId);
  const cancelSchedule = useCancelSchedule(agentId);

  const [selDate, setSelDate] = useState<string | null>(null);
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
    const d = new Date(s.run_at);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    (byDate[key] ||= []).push(s);
  });

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const dateKey = (day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;
  const isToday = (day: number) => year === today.getFullYear() && month === today.getMonth() && day === today.getDate();

  const prevMonth = () => { if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1); };

  const openDay = (day: number) => {
    setSelDate(dateKey(day));
    setTime('09:00'); setMessage(''); setRecipients(''); setFile(null); setErr('');
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
    if (!selDate) return;
    const runAt = new Date(`${selDate}T${time}:00`);
    if (runAt.getTime() < Date.now()) { setErr('Waktu jadwal sudah lewat'); return; }
    const fd = new FormData();
    fd.append('message', message);
    fd.append('recipients', JSON.stringify(recList));
    fd.append('run_at', runAt.toISOString());
    fd.append('min_delay', String(minDelay));
    fd.append('max_delay', String(maxDelay));
    if (file) fd.append('file', file);
    try {
      await createSchedule.mutateAsync(fd);
      setMessage(''); setRecipients(''); setFile(null);
    } catch (e) {
      setErr(errorMessage(e, 'Gagal menjadwalkan'));
    }
  };

  const daySchedules = selDate ? (byDate[selDate] || []) : [];

  return (
    <Box>
      <PageHeader title="Kalender"
        subtitle="Klik tanggal untuk menjadwalkan broadcast. Pesan otomatis terkirim saat waktunya tiba (lewat mesin broadcast yang sama: cek opt-out + jeda aman)." />

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
            {cells.map((day, i) => day === null ? <Box key={i} /> : (
              <Box key={i} onClick={() => openDay(day)}
                sx={{
                  cursor: 'pointer', border: '1px solid', borderColor: 'divider', borderRadius: 1.5,
                  minHeight: { xs: 46, sm: 56 }, p: 0.5, bgcolor: isToday(day) ? '#e8f5e9' : '#fff',
                  '&:hover': { bgcolor: '#f1f8f4' },
                }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{day}</Typography>
                {byDate[dateKey(day)]?.length > 0 && (
                  <Chip size="small" label={byDate[dateKey(day)].length} color="primary" sx={{ height: 18, fontSize: 11, mt: 0.5, display: 'block', width: 'fit-content' }} />
                )}
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Dialog open={!!selDate} onClose={() => setSelDate(null)} fullWidth maxWidth="sm">
        <DialogTitle>Jadwal · {selDate}</DialogTitle>
        <DialogContent dividers>
          {daySchedules.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Sudah dijadwalkan</Typography>
              {daySchedules.map(s => (
                <Stack key={s.id} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', p: 1, mb: 0.5, border: '1px solid #eee', borderRadius: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {new Date(s.run_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · {s.recipient_count} nomor
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                      {s.media_type && '📎 '}{s.message}
                    </Typography>
                  </Box>
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                    <Chip size="small" label={s.status} color={STATUS_COLOR[s.status] ?? 'default'} />
                    {s.status === 'scheduled' && (
                      <IconButton size="small" color="error" onClick={async () => { if (await swalConfirm('Batalkan jadwal ini?')) cancelSchedule.mutate(s.id); }}><DeleteIcon fontSize="small" /></IconButton>
                    )}
                  </Stack>
                </Stack>
              ))}
              <Divider sx={{ my: 1.5 }} />
            </Box>
          )}

          <Typography variant="subtitle2" sx={{ mb: 1 }}>Jadwalkan pesan baru</Typography>
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
          <Button onClick={() => setSelDate(null)}>Tutup</Button>
          <Button variant="contained" onClick={save} disabled={createSchedule.isPending}
            startIcon={createSchedule.isPending ? <CircularProgress size={16} /> : null}>
            Simpan Jadwal
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
