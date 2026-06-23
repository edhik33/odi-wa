import { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Chip, CircularProgress, TextField,
  Stack, Avatar, IconButton, Paper, Grid, Select, MenuItem, FormControl, InputLabel, Divider,
  Switch, FormControlLabel,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import QrCodeIcon from '@mui/icons-material/QrCode';
import { QRCodeSVG } from 'qrcode.react';
import api from '../services/api';
import SettingsIcon from '@mui/icons-material/Settings';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import UsageCard from '../components/UsageCard';
import BillingPanel from '../components/BillingPanel';
import InboxPanel from '../components/InboxPanel';
import TestChatPanel from '../components/TestChatPanel';
import AnalyticsPanel from '../components/AnalyticsPanel';
import BroadcastPanel from '../components/BroadcastPanel';
import CalendarPanel from '../components/CalendarPanel';
import AutoReplyPanel from '../components/AutoReplyPanel';
import PageHeader from '../components/PageHeader';

const TONES = [
  { value: 'ramah', label: '😊 Ramah' },
  { value: 'formal', label: '👔 Formal' },
  { value: 'santai', label: '🏖️ Santai' },
  { value: 'persuasif', label: '💪 Persuasif' },
  { value: 'custom', label: '✏️ Custom' },
];

export default function Dashboard() {
  const [tab, setTab] = useState(() => Number(localStorage.getItem('wai_tab')) || 0);
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState<number>(() => Number(localStorage.getItem('wai_agent')) || 0);
  const [status, setStatus] = useState('');
  const [qr, setQr] = useState('');
  const [waNumber, setWaNumber] = useState('');
  const [waName, setWaName] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [agentName, setAgentName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('ramah');
  const [saved, setSaved] = useState(false);
  const [greetEnabled, setGreetEnabled] = useState(false);
  const [greetMsg, setGreetMsg] = useState('');
  const [bhEnabled, setBhEnabled] = useState(false);
  const [bhStart, setBhStart] = useState('08:00');
  const [bhEnd, setBhEnd] = useState('21:00');
  const [awayMsg, setAwayMsg] = useState('');
  const [knowledge, setKnowledge] = useState<any[]>([]);
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [newTags, setNewTags] = useState('');
  const [genText, setGenText] = useState('');
  const [genCount, setGenCount] = useState(5);
  const [genLoading, setGenLoading] = useState(false);
  const [statusMap, setStatusMap] = useState<{ [k: string]: string }>({});
  const [handoffs, setHandoffs] = useState<any[]>([]);
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const loadAgents = async (selectId?: number) => {
    try {
      const r = await api.get('/agents');
      const list = r.data.data || [];
      setAgents(list);
      if (selectId) setAgentId(selectId);
      else if (list.length && !list.some((a: any) => a.id === agentId)) setAgentId(list[0].id);
    } catch {}
  };

  // Muat data CS terpilih (status/QR/chat/knowledge). Dipanggil berkala.
  const loadData = async (id = agentId) => {
    if (!id) return;
    try {
      const [s, h, k, ho] = await Promise.all([
        api.get(`/agents/${id}/wa/status`),
        api.get(`/agents/${id}/chat-history`),
        api.get(`/agents/${id}/knowledge`),
        api.get(`/agents/${id}/handoffs`),
      ]);
      setStatus(s.data.status); setQr(s.data.qr || '');
      setWaNumber(s.data.number || ''); setWaName(s.data.name || '');
      setHistory(h.data.data || []);
      setKnowledge(k.data.data || []);
      setHandoffs(ho.data.data || []);
    } catch {}
  };

  useEffect(() => { loadAgents(); }, []);

  // Simpan tab & CS terpilih supaya tidak balik ke awal saat refresh.
  useEffect(() => { localStorage.setItem('wai_tab', String(tab)); }, [tab]);
  useEffect(() => { if (agentId) localStorage.setItem('wai_agent', String(agentId)); }, [agentId]);

  // Polling status semua CS untuk titik indikator (tidak menyentuh form/persona).
  useEffect(() => {
    const f = async () => { try { const r = await api.get('/agents-status'); setStatusMap(r.data.data || {}); } catch {} };
    f();
    const i = setInterval(f, 3000);
    return () => clearInterval(i);
  }, []);

  // Saat ganti CS: muat datanya, isi field persona dari daftar (tidak ditimpa polling), pasang polling status.
  useEffect(() => {
    if (!agentId) return;
    loadData(agentId);
    const a = agents.find(x => x.id === agentId);
    if (a) {
      setAgentName(a.name || ''); setPrompt(a.system_prompt || ''); setTone(a.tone || 'ramah');
      setGreetEnabled(!!a.greeting_enabled); setGreetMsg(a.greeting_message || '');
      setBhEnabled(!!a.business_hours_enabled); setBhStart(a.business_start || '08:00');
      setBhEnd(a.business_end || '21:00'); setAwayMsg(a.away_message || '');
    }
    const i = setInterval(() => loadData(agentId), 3000);
    return () => clearInterval(i);
  }, [agentId, agents]);

  const connect = async () => { setLoading(true); await api.post(`/agents/${agentId}/wa/connect`); await loadData(agentId); setLoading(false); };

  const disconnectWA = async () => {
    if (!window.confirm('Putuskan WhatsApp dari nomor ini? Perlu scan QR lagi untuk menyambung kembali.')) return;
    setLoading(true);
    try { await api.post(`/agents/${agentId}/wa/logout`); } catch {}
    await loadData(agentId);
    setLoading(false);
  };

  const resumeHandoff = async (sender: string) => {
    await api.delete(`/agents/${agentId}/handoffs/${sender}`);
    loadData(agentId);
  };

  const saveAgent = async () => {
    await api.put(`/agents/${agentId}`, {
      name: agentName, system_prompt: prompt, tone,
      greeting_enabled: greetEnabled, greeting_message: greetMsg,
      business_hours_enabled: bhEnabled, business_start: bhStart, business_end: bhEnd, away_message: awayMsg,
    });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    loadAgents(agentId);
  };

  const createAgent = async () => {
    const name = window.prompt('Nama CS baru (mis. Toko HP):');
    if (!name) return;
    const r = await api.post('/agents', { name, tone: 'ramah' });
    loadAgents(r.data.data.id);
    setTab(0);
  };

  const deleteAgent = async () => {
    if (agents.length <= 1) { alert('Minimal harus ada 1 CS.'); return; }
    if (!window.confirm('Hapus CS ini beserta knowledge-nya?')) return;
    await api.delete(`/agents/${agentId}`);
    setAgentId(0);
    loadAgents();
  };

  const addKnowledge = async () => {
    if (!newQ || !newA) return;
    await api.post(`/agents/${agentId}/knowledge`, { question: newQ, answer: newA, tags: newTags });
    setNewQ(''); setNewA(''); setNewTags(''); loadData(agentId);
  };
  const delKnowledge = async (id: number) => { await api.delete(`/agents/${agentId}/knowledge/${id}`); loadData(agentId); };

  const generateKnowledge = async () => {
    if (!genText.trim()) return;
    setGenLoading(true);
    try {
      await api.post(`/agents/${agentId}/knowledge/generate`, { text: genText, count: genCount });
      setGenText('');
      loadData(agentId);
    } catch (e) {
      alert('Gagal generate knowledge');
    }
    setGenLoading(false);
  };

  const dotColor = (s?: string) => (s === 'connected' ? '#25D366' : s === 'qr' ? '#ffa726' : '#bdbdbd');

  const logout = () => { localStorage.clear(); window.location.href = '/login'; };
  const tabs = ['Dashboard', 'Inbox', 'Coba Chat', 'Knowledge Base', 'Analitik', 'Broadcast', 'Kalender', 'Auto-Reply', 'Settings', 'Langganan'];
  const sc = status === 'connected' ? 'success' : status === 'qr' ? 'warning' : 'error';
  const sl = status === 'connected' ? 'Online' : status === 'qr' ? 'Scan QR' : 'Offline';
  const currentAgent = agents.find(a => a.id === agentId);

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: '100vh', bgcolor: '#f0f2f5' }}>
      <Paper sx={{ width: { xs: '100%', md: 240 }, borderRadius: 0, p: 2, display: 'flex', flexDirection: { xs: 'row', md: 'column' }, flexWrap: 'wrap', alignItems: { xs: 'center', md: 'stretch' }, gap: { xs: 1, md: 0 }, position: { xs: 'sticky', md: 'static' }, top: 0, zIndex: 10 }}>
        <Box sx={{ mb: { xs: 0, md: 2 }, mr: { xs: 1, md: 0 }, textAlign: 'center' }}>
          <Avatar sx={{ width: 40, height: 40, mx: 'auto', mb: 0.5, bgcolor: '#25D366', display: { xs: 'none', sm: 'flex' } }}>W</Avatar>
          <Typography sx={{ fontWeight: 700, fontSize: { xs: 14, md: 16 } }}>WA Assistant</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>{user.name || user.username}</Typography>
        </Box>

        <FormControl size="small" sx={{ mb: { xs: 0, md: 1 }, width: { xs: 150, md: '100%' }, flexShrink: 0 }}>
          <InputLabel>CS / Nomor</InputLabel>
          <Select value={agents.length ? agentId : ''} label="CS / Nomor"
            onChange={e => setAgentId(Number(e.target.value))}>
            {agents.map(a => (
              <MenuItem key={a.id} value={a.id}>
                <Box component="span" sx={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', bgcolor: dotColor(statusMap[a.id]), mr: 1 }} />
                {a.name || `CS ${a.id}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button size="small" startIcon={<AddIcon />} onClick={createAgent} sx={{ mb: { xs: 0, md: 2 }, textTransform: 'none' }}>
          Tambah CS
        </Button>
        <Divider sx={{ mb: 1, width: '100%', display: { xs: 'none', md: 'block' } }} />

        {tabs.map((t, i) => (
          <Button key={i} variant={tab === i ? 'contained' : 'text'}
            onClick={() => setTab(i)} sx={{ mb: 0.5, justifyContent: { xs: 'center', md: 'flex-start' }, textTransform: 'none' }}>
            {t}
          </Button>
        ))}
        <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />
        <Button startIcon={<LogoutIcon />} onClick={logout} color="error" sx={{ textTransform: 'none', ml: { xs: 'auto', md: 0 } }}>Logout</Button>
      </Paper>

      <Box sx={{ flex: 1, p: { xs: 2, md: 3 }, overflow: 'auto', width: '100%', boxSizing: 'border-box' }}>
        {tab === 0 && (
          <Box>
            <PageHeader title={<>Dashboard {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>· {currentAgent.name}</Typography>}</>} />
            <UsageCard />
            <Card sx={{ mb: 2 }}>
              <CardContent sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: 2 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75, textAlign: 'left' }}>
                  <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2 }}>Status WhatsApp</Typography>
                  <Chip label={sl} color={sc} size="small" />
                  {status === 'connected' && waNumber && (
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{waName || 'Tanpa nama profil'}</Typography>
                      <Typography variant="body2" color="text.secondary">+{waNumber}</Typography>
                    </Box>
                  )}
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={connect} disabled={loading}
                    startIcon={loading ? <CircularProgress size={16} /> : <QrCodeIcon />}>
                    {status === 'connected' ? 'Reconnect' : 'Connect WA'}
                  </Button>
                  {status === 'connected' && (
                    <Button variant="outlined" color="error" onClick={disconnectWA} disabled={loading}
                      startIcon={<LogoutIcon />}>
                      Putuskan
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>
            {qr && (
              <Card sx={{ mb: 2, bgcolor: '#fff', textAlign: 'center' }}>
                <CardContent>
                  <Typography sx={{ fontWeight: 600, mb: 1 }}>Scan QR Code di WhatsApp</Typography>
                  <QRCodeSVG value={qr} size={200} level="L" includeMargin />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Buka WhatsApp → Linked Devices → Scan
                  </Typography>
                </CardContent>
              </Card>
            )}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid size={4}><Card><CardContent><Typography variant="h4" sx={{ fontWeight: 800 }}>{history.length}</Typography><Typography variant="caption">Chat</Typography></CardContent></Card></Grid>
              <Grid size={4}><Card><CardContent><Typography variant="h4" sx={{ fontWeight: 800 }}>{knowledge.length}</Typography><Typography variant="caption">Knowledge</Typography></CardContent></Card></Grid>
              <Grid size={4}><Card><CardContent><Typography variant="h4" sx={{ fontWeight: 800 }}>{agents.length}</Typography><Typography variant="caption">Total CS</Typography></CardContent></Card></Grid>
            </Grid>

            {handoffs.length > 0 && (
              <Card sx={{ mt: 2, border: '2px solid #ffa726' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>🙋 Butuh Dibalas Manusia ({handoffs.length})</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
                    Bot menunda jawaban untuk kontak ini. Balas mereka langsung dari WhatsApp HP-mu, lalu klik "Aktifkan bot" kalau sudah selesai.
                  </Typography>
                  {handoffs.map(h => (
                    <Box key={h.id} sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1, p: 1.5, mb: 1, bgcolor: '#fff', borderRadius: 1, border: '1px solid #eee' }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>+{h.sender}</Typography>
                        <Typography variant="caption" color="text.secondary">"{h.last_msg}"</Typography>
                      </Box>
                      <Button size="small" variant="outlined" onClick={() => resumeHandoff(h.sender)} sx={{ flexShrink: 0 }}>Aktifkan bot</Button>
                    </Box>
                  ))}
                </CardContent>
              </Card>
            )}
          </Box>
        )}

        {tab === 3 && (
          <Box>
            <PageHeader title={<>Knowledge Base {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>· {currentAgent.name}</Typography>}</>} />

            {/* AI Generate */}
            <Card sx={{ mb: 2, border: '2px solid #25D366' }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  <AutoAwesomeIcon sx={{ mr: 0.5, verticalAlign: 'middle', color: '#25D366' }} />
                  Generate Otomatis dengan AI
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Paste teks/artikel/dokumen, AI otomatis buatkan Q&A pairs + tags.
                </Typography>
                <TextField multiline rows={4} fullWidth size="small" value={genText}
                  onChange={e => setGenText(e.target.value)}
                  placeholder="Paste teks di sini..."
                  sx={{ mb: 1 }} />
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <TextField type="number" size="small" label="Jumlah Q&A" value={genCount}
                    onChange={e => setGenCount(Number(e.target.value))} sx={{ width: 120 }} />
                  <Button variant="contained" onClick={generateKnowledge} disabled={genLoading}
                    startIcon={genLoading ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}>
                    Generate
                  </Button>
                </Stack>
              </CardContent>
            </Card>

            {/* Manual Add */}
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Tambah Manual</Typography>
                <Stack spacing={1}>
                  <TextField size="small" label="Pertanyaan" value={newQ} onChange={e => setNewQ(e.target.value)} />
                  <TextField size="small" label="Jawaban" multiline rows={2} value={newA} onChange={e => setNewA(e.target.value)} />
                  <TextField size="small" label="Tags (koma)" value={newTags} onChange={e => setNewTags(e.target.value)} />
                  <Button startIcon={<AddIcon />} variant="contained" onClick={addKnowledge}>Tambah</Button>
                </Stack>
              </CardContent>
            </Card>

            {knowledge.map((k, i) => (
              <Card key={i} sx={{ mb: 1 }}>
                <CardContent sx={{ '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Box>
                      <Typography sx={{ fontWeight: 600 }}>Q: {k.question}</Typography>
                      <Typography variant="body2" color="text.secondary">A: {k.answer}</Typography>
                      <Typography variant="caption" color="primary">{k.tags}</Typography>
                    </Box>
                    <IconButton onClick={() => delKnowledge(k.id)} size="small" color="error"><DeleteIcon /></IconButton>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}

        {tab === 8 && (
          <Box>
            <PageHeader title={<><SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />Pengaturan {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>· {currentAgent.name}</Typography>}</>} />
            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Nama CS</Typography>
                <TextField fullWidth size="small" value={agentName} onChange={e => setAgentName(e.target.value)} sx={{ mb: 2 }} />
                <Typography variant="subtitle2" sx={{ mb: 0.25 }}>Tone / Gaya Bahasa</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  CARA bot bicara (ramah / formal / santai / persuasif).
                </Typography>
                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>Tone</InputLabel>
                  <Select value={tone} label="Tone" onChange={e => setTone(e.target.value)}>
                    {TONES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                  </Select>
                </FormControl>
                <Typography variant="subtitle2" sx={{ mb: 0.25 }}>System Prompt (Persona)</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  SIAPA bot ini & tugasnya: identitas bisnis, peran, batasan, aturan. Contoh: "Kamu admin Sedekah Bekas di Yogyakarta. Bantu pertanyaan donasi barang bekas. Jangan bahas di luar topik."
                </Typography>
                <TextField multiline rows={5} fullWidth value={prompt} onChange={e => setPrompt(e.target.value)}
                  placeholder='Contoh: Kamu admin "Toko Maju Jaya", jual sparepart motor. Bantu pelanggan soal stok, harga, & cara order.' />
                <Button variant="contained" onClick={saveAgent} sx={{ mt: 1 }}>{saved ? 'Tersimpan ✓' : 'Simpan'}</Button>
              </CardContent>
            </Card>

            <Card sx={{ mb: 2 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Sapaan Otomatis</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Pesan pembuka yang dikirim sekali saat kontak baru pertama kali chat.
                </Typography>
                <FormControlLabel control={<Switch checked={greetEnabled} onChange={e => setGreetEnabled(e.target.checked)} />} label="Aktifkan sapaan" />
                <TextField fullWidth multiline rows={2} size="small" label="Pesan sapaan" value={greetMsg}
                  onChange={e => setGreetMsg(e.target.value)} disabled={!greetEnabled} sx={{ mt: 1 }}
                  placeholder="Halo kak! Terima kasih sudah menghubungi kami 😊 Ada yang bisa dibantu?" />

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Jam Kerja</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Di luar jam kerja, bot tidak menjawab pakai AI. Pelanggan hanya menerima pesan otomatis di bawah (sekali), dan pesannya tetap masuk ke Inbox untuk kamu balas nanti.
                </Typography>
                <FormControlLabel control={<Switch checked={bhEnabled} onChange={e => setBhEnabled(e.target.checked)} />} label="Batasi jam kerja" />
                <Stack direction="row" spacing={2} sx={{ my: 1 }}>
                  <TextField type="time" label="Mulai" size="small" value={bhStart} onChange={e => setBhStart(e.target.value)}
                    disabled={!bhEnabled} slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField type="time" label="Selesai" size="small" value={bhEnd} onChange={e => setBhEnd(e.target.value)}
                    disabled={!bhEnabled} slotProps={{ inputLabel: { shrink: true } }} />
                </Stack>
                <TextField fullWidth multiline rows={2} size="small" label="Pesan di luar jam kerja" value={awayMsg}
                  onChange={e => setAwayMsg(e.target.value)} disabled={!bhEnabled}
                  placeholder="Mohon maaf, kami sedang di luar jam operasional. Pesan kakak akan kami balas pada jam kerja ya 🙏" />

                <Button variant="contained" onClick={saveAgent} sx={{ mt: 2 }}>{saved ? 'Tersimpan ✓' : 'Simpan'}</Button>
              </CardContent>
            </Card>

            <Card sx={{ border: '1px solid #f5c2c7' }}>
              <CardContent>
                <Typography variant="subtitle2" color="error" sx={{ mb: 1 }}>Zona Berbahaya</Typography>
                <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={deleteAgent}>Hapus CS ini</Button>
              </CardContent>
            </Card>
          </Box>
        )}

        {tab === 9 && <BillingPanel />}
        {tab === 1 && <InboxPanel agentId={agentId} />}
        {tab === 2 && <TestChatPanel agentId={agentId} />}
        {tab === 4 && <AnalyticsPanel agentId={agentId} />}
        {tab === 5 && <BroadcastPanel agentId={agentId} />}
        {tab === 6 && <CalendarPanel agentId={agentId} />}
        {tab === 7 && <AutoReplyPanel agentId={agentId} />}
      </Box>
    </Box>
  );
}
