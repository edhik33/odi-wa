import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button, Stack, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, LinearProgress, CircularProgress, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useCheckNumbers, useCreateBroadcast, useBroadcasts } from '../hooks';
import type { NumberCheck } from '../types';

function normalizePhone(s: string): string {
  const d = (s.match(/\d/g) || []).join('');
  if (!d) return '';
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
}

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  done: 'success', running: 'warning', pending: 'default', interrupted: 'error',
};

export default function BroadcastPanel({ agentId }: { agentId: number }) {
  const [message, setMessage] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [minDelay, setMinDelay] = useState(10);
  const [maxDelay, setMaxDelay] = useState(30);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [checked, setChecked] = useState<NumberCheck[] | null>(null);

  const checkNumbers = useCheckNumbers(agentId);
  const createBroadcast = useCreateBroadcast(agentId);
  const { data: broadcasts } = useBroadcasts(agentId);

  const parsed = recipientsText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [num, ...rest] = line.split(',');
    return { number: normalizePhone(num), name: rest.join(',').trim() };
  }).filter(r => r.number);

  const nameMap: Record<string, string> = {};
  parsed.forEach(p => { nameMap[p.number] = p.name; });

  const registered = (checked || []).filter(c => c.registered);

  const openModal = () => {
    setInfo('');
    if (!message.trim()) { setInfo('Pesan tidak boleh kosong.'); return; }
    if (parsed.length === 0) { setInfo('Masukkan minimal satu nomor.'); return; }
    setChecked(null);
    setModalOpen(true);
    checkNumbers.mutateAsync(parsed.map(p => p.number)).then(setChecked).catch(() => setChecked([]));
  };

  const doSend = async () => {
    const recipients = registered.map(c => ({ number: c.number, name: nameMap[c.number] || '' }));
    if (recipients.length === 0) return;
    await createBroadcast.mutateAsync({ message, recipients, min_delay: minDelay, max_delay: maxDelay, file });
    setModalOpen(false);
    setChecked(null);
    setInfo(`Broadcast dimulai untuk ${recipients.length} nomor. Pantau progres di bawah.`);
  };

  const checking = checkNumbers.isPending || checked === null;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>Broadcast</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Kirim pesan (bisa dengan gambar/file) ke banyak kontak dengan jeda aman. Nomor dicek dulu sebelum dikirim.
      </Typography>

      <Alert severity="warning" sx={{ mb: 3 }}>
        <b>Biar nomor tidak diblokir WhatsApp:</b> kirim hanya ke kontak yang sudah pernah berinteraksi,
        jangan ke nomor dingin. Mulai dari sedikit dulu (warm up), pakai jeda, dan sisipkan
        <code> {'{nama}'} </code> agar pesan tidak identik. Kontak yang membalas STOP otomatis berhenti.
      </Alert>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Pesan</Typography>
          <TextField fullWidth multiline rows={4} value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Halo {nama}, ada promo spesial untuk kamu hari ini…" sx={{ mb: 1.5 }} />

          {/* Lampiran */}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 2 }}>
            <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />}>
              Lampirkan gambar/file
              <input type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
            </Button>
            {file && <Chip label={file.name} size="small" onDelete={() => setFile(null)} deleteIcon={<CloseIcon />} />}
          </Stack>

          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Daftar Nomor</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Satu nomor per baris. Bisa juga format <code>nomor,nama</code> untuk personalisasi.
          </Typography>
          <TextField fullWidth multiline rows={5} value={recipientsText}
            onChange={e => { setRecipientsText(e.target.value); setChecked(null); }}
            placeholder={'08123456789,Budi\n08987654321,Sinta'} sx={{ mb: 2 }} />

          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField type="number" size="small" label="Jeda min (detik)" value={minDelay} onChange={e => setMinDelay(Number(e.target.value))} sx={{ width: 150 }} />
            <TextField type="number" size="small" label="Jeda maks (detik)" value={maxDelay} onChange={e => setMaxDelay(Number(e.target.value))} sx={{ width: 150 }} />
          </Stack>

          {info && <Alert severity="info" sx={{ mb: 2 }}>{info}</Alert>}

          <Button variant="contained" size="large" startIcon={<SendIcon />} onClick={openModal}>
            Cek Nomor &amp; Kirim ({parsed.length})
          </Button>
        </CardContent>
      </Card>

      {broadcasts && broadcasts.length > 0 && (
        <Card>
          <CardContent sx={{ overflowX: 'auto' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Riwayat Broadcast</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Waktu</TableCell>
                  <TableCell>Pesan</TableCell>
                  <TableCell align="center">Status</TableCell>
                  <TableCell sx={{ width: 210 }}>Progres</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {broadcasts.map(b => {
                  const done = b.sent + b.failed + b.skipped;
                  const pct = b.total ? Math.round((done / b.total) * 100) : 0;
                  return (
                    <TableRow key={b.id} hover>
                      <TableCell>{new Date(b.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</TableCell>
                      <TableCell sx={{ maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.message}</TableCell>
                      <TableCell align="center"><Chip label={b.status} size="small" color={STATUS_COLOR[b.status] ?? 'default'} /></TableCell>
                      <TableCell>
                        <LinearProgress variant="determinate" value={pct} color={b.status === 'done' ? 'success' : 'primary'} sx={{ height: 6, borderRadius: 3, mb: 0.5 }} />
                        <Typography variant="caption" color="text.secondary">
                          {b.sent} terkirim · {b.failed} gagal · {b.skipped} dilewati / {b.total}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Modal: cek nomor lalu kirim */}
      <Dialog open={modalOpen} onClose={() => !createBroadcast.isPending && setModalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Cek Nomor sebelum Kirim</DialogTitle>
        <DialogContent dividers>
          {checking ? (
            <Box sx={{ py: 2, textAlign: 'center' }}>
              <Typography sx={{ mb: 2 }}>Mengecek {parsed.length} nomor di WhatsApp…</Typography>
              <LinearProgress />
            </Box>
          ) : (
            <>
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Chip icon={<CheckCircleIcon />} label={`${registered.length} terdaftar`} color="success" />
                <Chip label={`${(checked?.length || 0) - registered.length} tidak terdaftar`} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Hanya nomor terdaftar yang akan dikirimi. {file && <>Dengan lampiran <b>{file.name}</b>. </>}Jeda {minDelay}–{maxDelay} detik antar pesan.
              </Typography>
              <Divider sx={{ mb: 1 }} />
              <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
                {checked?.map((c, i) => (
                  <Chip key={i} size="small" label={c.number} color={c.registered ? 'success' : 'default'}
                    variant={c.registered ? 'filled' : 'outlined'} sx={{ m: 0.25 }} />
                ))}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={createBroadcast.isPending}>Batal</Button>
          <Button variant="contained" onClick={doSend}
            disabled={checking || registered.length === 0 || createBroadcast.isPending}
            startIcon={createBroadcast.isPending ? <CircularProgress size={16} /> : <SendIcon />}>
            Kirim ke {registered.length} nomor
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
