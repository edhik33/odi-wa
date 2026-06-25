import { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button, Stack, Alert, AlertTitle, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, LinearProgress, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Checkbox, FormControlLabel,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useCheckNumbers, useCreateBroadcast, useBroadcasts, useBroadcastDetail } from '../hooks';
import RecipientField from './RecipientField';
import WhatsAppEditor from './WhatsAppEditor';
import TemplatePicker from './TemplatePicker';
import PageHeader from './PageHeader';
import type { NumberCheck, CheckResult } from '../types';

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

export default function BroadcastPanel({ agentId, seed }: { agentId: number; seed?: { value: string; n: number } | null }) {
  const [message, setMessage] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  // Prefill penerima saat datang dari menu Kontak ("Broadcast ke tag ini").
  useEffect(() => { if (seed?.value) setRecipientsText(seed.value); }, [seed?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const [minDelay, setMinDelay] = useState(10);
  const [maxDelay, setMaxDelay] = useState(30);
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [checked, setChecked] = useState<NumberCheck[] | null>(null);
  const [summary, setSummary] = useState<CheckResult['summary'] | null>(null);
  const [ackRisk, setAckRisk] = useState(false);
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
    const parts = line.split(/[\t,]/);
    const num = parts.find(p => /\d/.test(p)) || parts[0];
    const name = parts.filter(p => p !== num && p.trim()).join(' ').trim();
    return { number: normalizePhone(num), name };
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
    setSummary(null);
    setAckRisk(false);
    setModalOpen(true);
    checkNumbers.mutateAsync(parsed.map(p => p.number))
      .then(res => { setChecked(res.data); setSummary(res.summary); })
      .catch(() => { setChecked([]); setSummary(null); });
  };

  // Buang nomor tak terdaftar dari daftar & hasil cek (user yang putuskan, bukan otomatis).
  const dropUnregistered = () => {
    if (!checked) return;
    const regNums = new Set(checked.filter(c => c.registered).map(c => c.number));
    const kept = recipientsText.split('\n').map(l => l.trim()).filter(Boolean)
      .filter(line => regNums.has(normalizePhone(line.split(',')[0])));
    setRecipientsText(kept.join('\n'));
    setChecked(checked.filter(c => c.registered));
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

  // ---- Penilaian kesiapan kirim (gerbang anti-banned) ----
  const total = checked?.length || 0;
  const unreg = total - registered.length;
  const warmCount = registered.filter(c => c.warm).length;
  const coldCount = registered.length - warmCount;
  const batch = registered.length;
  const cap = summary?.daily_cap ?? 200;
  const sentToday = summary?.sent_today ?? 0;
  const remaining = Math.max(0, cap - sentToday);
  const coldRatio = batch ? coldCount / batch : 0;
  const unregRatio = total ? unreg / total : 0;
  const pct = (r: number) => `${Math.round(r * 100)}%`;

  type Finding = { sev: 'red' | 'yellow'; msg: string; tip?: string };
  const findings: Finding[] = [];
  if (unregRatio > 0.3) findings.push({ sev: 'red', msg: `${unreg} nomor tidak terdaftar WhatsApp (${pct(unregRatio)})`, tip: 'Buang nomor tak terdaftar dulu — nomor mati menaikkan sinyal spam.' });
  else if (unreg > 0) findings.push({ sev: 'yellow', msg: `${unreg} nomor tak terdaftar akan dilewati`, tip: 'Sebaiknya dibuang biar daftar bersih.' });
  if (coldRatio > 0.7 && batch > 100) findings.push({ sev: 'red', msg: `${coldCount} nomor (${pct(coldRatio)}) belum pernah chat denganmu`, tip: 'Utamakan kontak yang pernah chat, atau pecah jadi beberapa hari.' });
  else if (coldRatio > 0.4) findings.push({ sev: 'yellow', msg: `${coldCount} nomor (${pct(coldRatio)}) belum pernah chat`, tip: 'Lebih aman kirim ke yang pernah chat dulu.' });
  if (batch > remaining) findings.push({ sev: 'red', msg: `Batch ${batch} melebihi sisa jatah hari ini (${remaining})`, tip: `Kurangi jadi ≤ ${remaining} atau lanjut besok.` });
  else if (remaining > 0 && batch > remaining * 0.5) findings.push({ sev: 'yellow', msg: `Batch ini memakai sebagian besar jatah harian (sisa ${remaining})` });

  const level: 'green' | 'yellow' | 'red' =
    findings.some(f => f.sev === 'red') ? 'red' : findings.some(f => f.sev === 'yellow') ? 'yellow' : 'green';

  // ---- Lint pesan ----
  const lint: string[] = [];
  if (batch > 10 && !/\{nama\}/.test(message)) lint.push('Belum pakai {nama} — semua pesan identik, lebih mudah terdeteksi spam. Tambahkan {nama}.');
  if (/(https?:\/\/|www\.)/i.test(message)) lint.push('Pesan mengandung link — bisa menaikkan risiko. Pastikan domain tepercaya & relevan.');
  const letters = message.replace(/[^a-zA-Z]/g, '');
  if (letters.length >= 10 && letters === letters.toUpperCase()) lint.push('Pesan HURUF BESAR semua — terkesan berteriak/spam.');
  if (message.length > 700) lint.push('Pesan sangat panjang (>700 karakter) — pertimbangkan dipersingkat.');

  const VERDICT = {
    green: { sev: 'success' as const, title: '🟢 Aman dikirim' },
    yellow: { sev: 'warning' as const, title: '🟡 Hati-hati' },
    red: { sev: 'error' as const, title: '🔴 Tahan dulu' },
  }[level];
  const sendBlocked = level === 'red' && !ackRisk;

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
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Stack direction="row" spacing={1} alignItems="center"><Typography variant="subtitle2">Pesan</Typography><Typography variant="caption" color="text.secondary">({message.length}/2000)</Typography></Stack>
            <TemplatePicker agentId={agentId} onPick={b => { setMessage(m => m ? m + '\n' + b : b); if (errors.message) setErrors(p => ({...p, message: ''})); }} />
          </Stack>
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
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, mb: 3, alignItems: 'center' }}>
            <Button size="small" variant="outlined" onClick={() => {
              const formatted = recipientsText.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
                const parts = line.split(/[\t,]/);
                const num = parts.find(p => /\d/.test(p)) || parts[0];
                const name = parts.filter(p => p !== num && p.trim()).join(' ').trim();
                const n = normalizePhone(num);
                return n ? `${n},${name}` : line;
              }).join('\n');
              setRecipientsText(formatted);
            }}>Format Otomatis</Button>
            <Typography variant="caption" color="text.secondary">
              Disarankan pakai <b>"Pernah chat"</b> (hangat, aman). Sinkron WA / anggota grup lebih berisiko.
            </Typography>
          </Stack>

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

      {/* Modal: gerbang kesiapan kirim */}
      <Dialog open={modalOpen} onClose={() => !createBroadcast.isPending && setModalOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Kesiapan Kirim</DialogTitle>
        <DialogContent dividers>
          {checking ? (
            <Box sx={{ py: 2, textAlign: 'center' }}>
              <Typography sx={{ mb: 2 }}>Mengecek {parsed.length} nomor di WhatsApp…</Typography>
              <LinearProgress />
            </Box>
          ) : (
            <>
              <Alert severity={VERDICT.sev} sx={{ mb: 1.5 }}>
                <AlertTitle sx={{ fontWeight: 700, mb: findings.length ? 0.5 : 0 }}>{VERDICT.title}</AlertTitle>
                {findings.length === 0 ? (
                  <Typography variant="body2">Daftar terlihat sehat. Tetap kirim dengan jeda & secukupnya ya.</Typography>
                ) : (
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {findings.map((f, i) => (
                      <li key={i}>
                        <Typography variant="body2">{f.msg}{f.tip && <Box component="span" sx={{ display: 'block', opacity: 0.85 }}>↳ {f.tip}</Box>}</Typography>
                      </li>
                    ))}
                  </Box>
                )}
              </Alert>

              <Stack direction="row" spacing={0.75} sx={{ mb: 1.25, flexWrap: 'wrap', gap: 0.75 }}>
                <Chip size="small" icon={<CheckCircleIcon />} label={`${registered.length} terdaftar`} color="success" />
                {unreg > 0 && <Chip size="small" label={`${unreg} tak terdaftar`} color="default" variant="outlined" />}
                <Chip size="small" label={`${warmCount} hangat`} color="success" variant="outlined" />
                <Chip size="small" label={`${coldCount} dingin`} color={coldCount ? 'warning' : 'default'} variant="outlined" />
                <Chip size="small" label={`Terkirim hari ini ${sentToday}/${cap}`} variant="outlined" color={remaining === 0 ? 'warning' : 'default'} />
              </Stack>

              {unreg > 0 && (
                <Button size="small" variant="outlined" onClick={dropUnregistered} sx={{ mb: 1.25 }}>
                  Buang {unreg} nomor tak terdaftar
                </Button>
              )}

              {lint.length > 0 && (
                <Alert severity="info" icon={false} sx={{ mb: 1.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>Saran pesan</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {lint.map((l, i) => <li key={i}><Typography variant="caption">{l}</Typography></li>)}
                  </Box>
                </Alert>
              )}

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                Yang dikirimi cuma nomor terdaftar. {file && <>Ada lampiran <b>{file.name}</b>. </>}Antar pesan dikasih jeda {minDelay} sampai {maxDelay} detik biar lebih aman. Jatah harian reset tiap tengah malam. Penilaian ini bantu menurunkan risiko, bukan jaminan ya.
              </Typography>

              {level === 'red' && (
                <FormControlLabel
                  control={<Checkbox checked={ackRisk} onChange={e => setAckRisk(e.target.checked)} color="error" />}
                  label={<Typography variant="body2">Saya paham risikonya dan tetap mau mengirim</Typography>} />
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={createBroadcast.isPending}>Batal</Button>
          <Button variant="contained" color={level === 'red' ? 'error' : 'primary'} onClick={doSend}
            disabled={checking || registered.length === 0 || sendBlocked || createBroadcast.isPending}
            startIcon={createBroadcast.isPending ? <CircularProgress size={16} /> : <SendIcon />}>
            Kirim ke {registered.length} nomor
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
