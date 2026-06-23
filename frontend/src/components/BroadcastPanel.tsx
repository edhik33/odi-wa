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
import { useCheckNumbers, useCreateBroadcast, useBroadcasts, useBroadcastDetail } from '../hooks';
import RecipientField from './RecipientField';
import WhatsAppEditor from './WhatsAppEditor';
import PageHeader from './PageHeader';
import type { NumberCheck } from '../types';

function normalizePhone(s: string): string {
  const d = (s.match(/\d/g) || []).join('');
  if (!d) return '';
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
}

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  done: 'success', running: 'warning', pending: 'default', failed: 'error', interrupted: 'error',
};
const RCP_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  sent: 'success', failed: 'error', skipped: 'default', pending: 'warning',
};

export default function BroadcastPanel({ agentId }: { agentId: number }) {
  const [message, setMessage] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [minDelay, setMinDelay] = useState(10);
  const [maxDelay, setMaxDelay] = useState(30);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [checked, setChecked] = useState<NumberCheck[] | null>(null);
  const [page, setPage] = useState(1);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailFilter, setDetailFilter] = useState<'all' | 'sent' | 'failed' | 'skipped'>('all');
  const [detailSearch, setDetailSearch] = useState('');
  const closeDetail = () => { setDetailId(null); setDetailFilter('all'); setDetailSearch(''); };

  const checkNumbers = useCheckNumbers(agentId);
  const createBroadcast = useCreateBroadcast(agentId);
  const { data: bpage } = useBroadcasts(agentId, page);
  const { data: detail } = useBroadcastDetail(agentId, detailId);
  const broadcasts = bpage?.data || [];
  const totalPages = Math.max(1, Math.ceil((bpage?.total || 0) / (bpage?.limit || 10)));

  const parsed = recipientsText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [num, ...rest] = line.split(',');
    return { number: normalizePhone(num), name: rest.join(',').trim() };
  }).filter(r => r.number);

  const nameMap: Record<string, string> = {};
  parsed.forEach(p => { nameMap[p.number] = p.name; });

  const registered = (checked || []).filter(c => c.registered);

  const openModal = () => {
    setInfo('');
    const e: Record<string, string> = {};
    if (!message.trim()) e.message = 'Pesan tidak boleh kosong';
    if (parsed.length === 0) e.recipients = 'Masukkan minimal satu nomor';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
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
      <PageHeader title="Broadcast"
        subtitle="Kirim pesan (bisa dengan gambar/file) ke banyak kontak dengan jeda aman. Nomor dicek dulu sebelum dikirim." />

      <Alert severity="warning" sx={{ mb: 2 }}>
        <b>Biar nomor tidak diblokir WhatsApp:</b> kirim hanya ke kontak yang sudah pernah berinteraksi,
        jangan ke nomor dingin. Mulai dari sedikit dulu (warm up), pakai jeda, dan sisipkan
        <code> {'{nama}'} </code> agar pesan tidak identik. Kontak yang membalas STOP otomatis berhenti.
      </Alert>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Pesan</Typography>
          <Box sx={{ mb: 1.25 }}>
            <WhatsAppEditor value={message} onChange={v => { setMessage(v); if (errors.message) setErrors(p => ({...p, message: ''})); }}
              placeholder="Halo {nama}, ada promo spesial untuk kamu hari ini…" error={!!errors.message} helperText={errors.message} />
          </Box>

          {/* Lampiran */}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
            <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />}>
              Lampirkan gambar/file
              <input type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
            </Button>
            {file && <Chip label={file.name} size="small" onDelete={() => setFile(null)} deleteIcon={<CloseIcon />} />}
          </Stack>

          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Daftar Nomor</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
            Satu nomor per baris (format <code>nomor,nama</code> untuk personalisasi), atau impor dari sumber di bawah.
          </Typography>
          <RecipientField agentId={agentId} value={recipientsText} onChange={v => { setRecipientsText(v); setChecked(null); if (errors.recipients) setErrors(p => ({...p, recipients: ''})); }} error={errors.recipients} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, mb: 1.5, display: 'block' }}>
            Disarankan pakai <b>"Pernah chat"</b> (hangat, aman). Sinkron WA / anggota grup lebih berisiko.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
            <TextField type="number" size="small" label="Jeda min (detik)" value={minDelay} onChange={e => setMinDelay(Number(e.target.value))} sx={{ width: { xs: '100%', sm: 140 } }} />
            <TextField type="number" size="small" label="Jeda maks (detik)" value={maxDelay} onChange={e => setMaxDelay(Number(e.target.value))} sx={{ width: { xs: '100%', sm: 140 } }} />
          </Stack>

          {info && <Alert severity="info" sx={{ mb: 1.5 }}>{info}</Alert>}

          <Button variant="contained" startIcon={<SendIcon />} onClick={openModal}>
            Cek Nomor &amp; Kirim ({parsed.length})
          </Button>
        </CardContent>
      </Card>

      {broadcasts.length > 0 && (
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
                    <TableRow key={b.id} hover sx={{ cursor: 'pointer' }} onClick={() => setDetailId(b.id)}>
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
            <Stack direction="row" sx={{ justifyContent: 'flex-end', alignItems: 'center', mt: 1, gap: 1 }}>
              <Button size="small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Sebelumnya</Button>
              <Typography variant="caption">Hal {page} / {totalPages}</Typography>
              <Button size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Berikutnya</Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Detail broadcast: status per penerima */}
      <Dialog open={!!detailId} onClose={closeDetail} fullWidth maxWidth="sm">
        <DialogTitle>Detail Broadcast</DialogTitle>
        <DialogContent dividers>
          {detail ? (() => {
            const recs = detail.recipients;
            const q = detailSearch.replace(/\D/g, '');
            const shown = recs.filter(r =>
              (detailFilter === 'all' || r.status === detailFilter) && (!q || r.number.includes(q)));
            const FILTERS = [
              { k: 'all' as const, label: `Semua ${recs.length}` },
              { k: 'sent' as const, label: `Terkirim ${detail.broadcast.sent}` },
              { k: 'failed' as const, label: `Gagal ${detail.broadcast.failed}` },
              { k: 'skipped' as const, label: `Dilewati ${detail.broadcast.skipped}` },
            ];
            return (
              <>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>{detail.broadcast.message}</Typography>
                {detail.broadcast.media_type && (
                  <Chip size="small" label={`📎 ${detail.broadcast.file_name || detail.broadcast.media_type}`} sx={{ mb: 1.5 }} />
                )}
                <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                  {FILTERS.map(f => (
                    <Chip key={f.k} size="small" label={f.label} onClick={() => setDetailFilter(f.k)}
                      color={detailFilter === f.k ? 'primary' : 'default'} variant={detailFilter === f.k ? 'filled' : 'outlined'} />
                  ))}
                </Stack>
                <TextField size="small" fullWidth placeholder="Cari nomor…" value={detailSearch}
                  onChange={e => setDetailSearch(e.target.value)} sx={{ mb: 1 }} />
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
                      {shown.map(r => (
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
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Menampilkan {shown.length} dari {recs.length} penerima
                </Typography>
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
