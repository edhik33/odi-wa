import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button, Stack, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, LinearProgress, CircularProgress, Divider,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import SendIcon from '@mui/icons-material/Send';
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
  done: 'success', running: 'warning', pending: 'default', failed: 'error',
};

export default function BroadcastPanel({ agentId }: { agentId: number }) {
  const [message, setMessage] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [minDelay, setMinDelay] = useState(10);
  const [maxDelay, setMaxDelay] = useState(30);
  const [checked, setChecked] = useState<NumberCheck[] | null>(null);
  const [info, setInfo] = useState('');

  const checkNumbers = useCheckNumbers(agentId);
  const createBroadcast = useCreateBroadcast(agentId);
  const { data: broadcasts } = useBroadcasts(agentId);

  // Parse "nomor" atau "nomor,nama" per baris.
  const parsed = recipientsText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [num, ...rest] = line.split(',');
    return { number: normalizePhone(num), name: rest.join(',').trim() };
  }).filter(r => r.number);

  const nameMap: Record<string, string> = {};
  parsed.forEach(p => { nameMap[p.number] = p.name; });

  const doCheck = async () => {
    setInfo('');
    if (parsed.length === 0) { setInfo('Masukkan minimal satu nomor.'); return; }
    const res = await checkNumbers.mutateAsync(parsed.map(p => p.number));
    setChecked(res);
  };

  const registered = (checked || []).filter(c => c.registered);

  const doSend = async () => {
    setInfo('');
    // Pakai hasil cek (hanya yang terdaftar) bila sudah dicek; kalau belum, pakai semua nomor.
    const recipients = checked
      ? registered.map(c => ({ number: c.number, name: nameMap[c.number] || '' }))
      : parsed;
    if (recipients.length === 0) { setInfo('Tidak ada nomor untuk dikirim.'); return; }
    if (!message.trim()) { setInfo('Pesan tidak boleh kosong.'); return; }
    await createBroadcast.mutateAsync({ message, recipients, min_delay: minDelay, max_delay: maxDelay });
    setInfo(`Broadcast dimulai untuk ${recipients.length} nomor. Pantau progres di bawah.`);
    setChecked(null);
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>Broadcast</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Kirim pesan ke banyak kontak dengan jeda aman. Cek dulu nomornya, lalu kirim bertahap.
      </Typography>

      <Alert severity="warning" sx={{ mb: 3 }}>
        <b>Biar nomor tidak diblokir WhatsApp:</b> kirim hanya ke kontak yang sudah pernah berinteraksi,
        jangan ke nomor dingin/beli. Mulai dari sedikit dulu (warm up), gunakan jeda, dan sisipkan
        <code> {'{nama}'} </code> agar pesan tidak identik. Kontak yang membalas STOP otomatis berhenti.
      </Alert>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Pesan</Typography>
          <TextField fullWidth multiline rows={4} value={message} onChange={e => setMessage(e.target.value)}
            placeholder="Halo {nama}, ada promo spesial untuk kamu hari ini…" sx={{ mb: 2 }} />

          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Daftar Nomor</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Satu nomor per baris. Bisa juga format <code>nomor,nama</code> untuk personalisasi.
          </Typography>
          <TextField fullWidth multiline rows={5} value={recipientsText} onChange={e => { setRecipientsText(e.target.value); setChecked(null); }}
            placeholder={'08123456789,Budi\n08987654321,Sinta'} sx={{ mb: 2 }} />

          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <TextField type="number" size="small" label="Jeda min (detik)" value={minDelay} onChange={e => setMinDelay(Number(e.target.value))} sx={{ width: 150 }} />
            <TextField type="number" size="small" label="Jeda maks (detik)" value={maxDelay} onChange={e => setMaxDelay(Number(e.target.value))} sx={{ width: 150 }} />
          </Stack>

          {info && <Alert severity="info" sx={{ mb: 2 }}>{info}</Alert>}

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={checkNumbers.isPending ? <CircularProgress size={16} /> : <VerifiedIcon />}
              onClick={doCheck} disabled={checkNumbers.isPending}>
              Cek Nomor ({parsed.length})
            </Button>
            <Button variant="contained" startIcon={<SendIcon />} onClick={doSend} disabled={createBroadcast.isPending}>
              Kirim Broadcast
            </Button>
          </Stack>

          {checked && (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 1 }} />
              <Typography variant="body2" sx={{ mb: 1 }}>
                <Chip label={`${registered.length} terdaftar`} color="success" size="small" sx={{ mr: 1 }} />
                <Chip label={`${checked.length - registered.length} tidak terdaftar`} color="default" size="small" />
                {' '}— hanya yang terdaftar yang akan dikirimi.
              </Typography>
              <Box sx={{ maxHeight: 160, overflowY: 'auto' }}>
                {checked.map((c, i) => (
                  <Chip key={i} size="small" label={c.number} color={c.registered ? 'success' : 'default'}
                    variant={c.registered ? 'filled' : 'outlined'} sx={{ m: 0.25 }} />
                ))}
              </Box>
            </Box>
          )}
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
                  <TableCell sx={{ width: 200 }}>Progres</TableCell>
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
                        <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3, mb: 0.5 }} />
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
    </Box>
  );
}
