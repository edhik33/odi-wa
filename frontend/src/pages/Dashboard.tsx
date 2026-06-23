import { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Chip, CircularProgress, TextField,
  Stack, IconButton, Paper, Grid, Select, MenuItem, FormControl, InputLabel, Divider,
  Switch, FormControlLabel,
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import QrCodeIcon from '@mui/icons-material/QrCode';
import DashboardIcon from '@mui/icons-material/DashboardOutlined';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import ChatIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import KnowledgeIcon from '@mui/icons-material/MenuBookOutlined';
import CampaignIcon from '@mui/icons-material/CampaignOutlined';
import CalendarIcon from '@mui/icons-material/CalendarMonthOutlined';
import RuleIcon from '@mui/icons-material/RuleOutlined';
import TemplateIcon from '@mui/icons-material/TextSnippetOutlined';
import FollowUpIcon from '@mui/icons-material/ScheduleSendOutlined';
import ContactsIcon from '@mui/icons-material/ContactsOutlined';
import CreditCardIcon from '@mui/icons-material/CreditCardOutlined';
import { QRCodeSVG } from 'qrcode.react';
import logo from '../assets/logo-chatloop-1.png';
import { swalConfirm, swalPrompt, swalAlert, swalToast } from '../services/swal';
import SettingsIcon from '@mui/icons-material/Settings';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SmartToyIcon from '@mui/icons-material/SmartToyOutlined';
import UsageCard from '../components/UsageCard';
import BillingPanel from '../components/BillingPanel';
import InboxPanel from '../components/InboxPanel';
import TestChatPanel from '../components/TestChatPanel';
import BroadcastPanel from '../components/BroadcastPanel';
import CalendarPanel from '../components/CalendarPanel';
import AutoReplyPanel from '../components/AutoReplyPanel';
import TemplatePanel from '../components/TemplatePanel';
import ContactsPanel from '../components/ContactsPanel';
import FollowUpPanel from '../components/FollowUpPanel';
import PageHeader from '../components/PageHeader';
import {
  useAgents, useAgentStatuses, useAgentStatus, useAgentKnowledge,
  useCreateAgent, useDeleteAgent, useSaveAgent, useAgentConnect, useAgentDisconnect,
  useAddKnowledge, useDeleteKnowledge, useGenerateKnowledge,
} from '../hooks';

const TONES = [
  { value: 'ramah', label: '😊 Ramah' },
  { value: 'formal', label: '👔 Formal' },
  { value: 'santai', label: '🏖️ Santai' },
  { value: 'persuasif', label: '💪 Persuasif' },
  { value: 'custom', label: '✏️ Custom' },
];

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon fontSize="small" /> },
  { id: 'inbox', label: 'Inbox', icon: <InboxIcon fontSize="small" /> },
  { id: 'kontak', label: 'Kontak', icon: <ContactsIcon fontSize="small" /> },
  { id: 'coba-chat', label: 'Coba Chat', icon: <ChatIcon fontSize="small" /> },
  { id: 'knowledge', label: 'Knowledge', icon: <KnowledgeIcon fontSize="small" /> },
  { id: 'broadcast', label: 'Broadcast', icon: <CampaignIcon fontSize="small" /> },
  { id: 'kalender', label: 'Kalender', icon: <CalendarIcon fontSize="small" /> },
  { id: 'auto-reply', label: 'Auto-Reply', icon: <RuleIcon fontSize="small" /> },
  { id: 'template', label: 'Template', icon: <TemplateIcon fontSize="small" /> },
  { id: 'follow-up', label: 'Follow-up', icon: <FollowUpIcon fontSize="small" /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon fontSize="small" /> },
  { id: 'langganan', label: 'Langganan', icon: <CreditCardIcon fontSize="small" /> },
];

export default function Dashboard() {
  const [tab, setTab] = useState(() => {
    const saved = localStorage.getItem('wai_tab');
    return saved && NAV_ITEMS.some(n => n.id === saved) ? saved : 'dashboard';
  });
  // seed = data yang dioper antar-tab (mis. dari Kontak ke Broadcast/Inbox). n = pemicu agar efek jalan ulang.
  const [seed, setSeed] = useState<{ kind: 'broadcast' | 'inbox'; value: string; n: number } | null>(null);
  const [agentId, setAgentId] = useState<number>(() => Number(localStorage.getItem('wai_agent')) || 0);
  const [agentName, setAgentName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('ramah');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [saved, setSaved] = useState(false);
  const [greetEnabled, setGreetEnabled] = useState(false);
  const [greetMsg, setGreetMsg] = useState('');
  const [bhEnabled, setBhEnabled] = useState(false);
  const [bhStart, setBhStart] = useState('08:00');
  const [bhEnd, setBhEnd] = useState('21:00');
  const [awayMsg, setAwayMsg] = useState('');
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [newTags, setNewTags] = useState('');
  const [genText, setGenText] = useState('');
  const [genCount, setGenCount] = useState(5);
  const [knowledgePage, setKnowledgePage] = useState(0);
  const [knowledgeErrors, setKnowledgeErrors] = useState<Record<string, string>>({});
  const KNOWLEDGE_PER_PAGE = 10;
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string>>({});
  const user = JSON.parse(localStorage.getItem('user') || '{}') as { name?: string; username?: string };

  // ---- TanStack Query: data fetching + auto-polling, tanpa useEffect/setInterval manual ----

  const { data: agents = [] } = useAgents();
  const { data: statusMap = {} } = useAgentStatuses();
  const { data: statusData } = useAgentStatus(agentId);
  const { data: knowledge = [] } = useAgentKnowledge(agentId);

  const status = statusData?.status || '';
  const qr = statusData?.qr || '';
  const waNumber = statusData?.number || '';
  const waName = statusData?.name || '';

  // ---- Mutations (TanStack Query) ----

  const connectMut = useAgentConnect(agentId);
  const disconnectMut = useAgentDisconnect(agentId);
  const saveAgentMut = useSaveAgent(agentId);
  const createAgentMut = useCreateAgent();
  const deleteAgentMut = useDeleteAgent();
  const addKnowledgeMut = useAddKnowledge(agentId);
  const deleteKnowledgeMut = useDeleteKnowledge(agentId);
  const generateKnowledgeMut = useGenerateKnowledge(agentId);

  // ---- Pilih CS pertama secara otomatis jika belum ada ----

  useEffect(() => {
    if (agents.length && !agents.some(a => a.id === agentId)) {
      setAgentId(agents[0].id);
    }
  }, [agents, agentId]);

  // ---- Isi field persona saat ganti CS ----

  useEffect(() => {
    if (!agentId) return;
    setKnowledgePage(0);
    const a = agents.find(x => x.id === agentId);
    if (a) {
      setAgentName(a.name || ''); setPrompt(a.system_prompt || ''); setTone(a.tone || 'ramah');
      setAiEnabled(a.ai_enabled !== false);
      setGreetEnabled(!!a.greeting_enabled); setGreetMsg(a.greeting_message || '');
      setBhEnabled(!!a.business_hours_enabled); setBhStart(a.business_start || '08:00');
      setBhEnd(a.business_end || '21:00'); setAwayMsg(a.away_message || '');
    }
  }, [agentId, agents]);

  // ---- Simpan tab & CS ke localStorage ----

  useEffect(() => { localStorage.setItem('wai_tab', tab); }, [tab]);
  useEffect(() => { if (agentId) localStorage.setItem('wai_agent', String(agentId)); }, [agentId]);

  // ---- Handlers ----

  const connect = () => connectMut.mutateAsync();

  const disconnectWA = async () => {
    if (!await swalConfirm('Putuskan WhatsApp?', 'Perlu scan QR lagi untuk menyambung kembali.')) return;
    try { await disconnectMut.mutateAsync(); } catch { /* refresh status agar UI tetap sinkron */ }
  };

  const saveAgent = async () => {
    const e: Record<string, string> = {};
    if (!agentName.trim()) e.agentName = 'Nama CS wajib diisi';
    setSettingsErrors(e);
    if (Object.keys(e).length > 0) return;
    await saveAgentMut.mutateAsync({
      name: agentName, system_prompt: prompt, tone,
      greeting_enabled: greetEnabled, greeting_message: greetMsg,
      business_hours_enabled: bhEnabled, business_start: bhStart, business_end: bhEnd, away_message: awayMsg,
    });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const toggleAI = async (val: boolean) => {
    setAiEnabled(val); // UI langsung berubah (optimistic)
    try {
      await saveAgentMut.mutateAsync({ ai_enabled: val });
      swalToast(val ? 'Balasan AI diaktifkan' : 'Balasan AI dimatikan — chat masuk Inbox', 'success');
    } catch {
      setAiEnabled(!val); // gagal -> kembalikan
      swalToast('Gagal mengubah status AI', 'error');
    }
  };

  const createAgent = async () => {
    const name = await swalPrompt('Nama CS baru', 'mis. Toko HP');
    if (!name) return;
    const r = await createAgentMut.mutateAsync({ name, tone: 'ramah' });
    setAgentId(r.data.id);
    setTab('dashboard');
  };

  const deleteAgent = async () => {
    if (agents.length <= 1) { await swalAlert('Minimal harus ada 1 CS.', 'warning'); return; }
    if (!await swalConfirm('Hapus CS ini?', 'Semua knowledge-nya juga akan terhapus.')) return;
    await deleteAgentMut.mutateAsync(agentId);
    setAgentId(0);
  };

  const addKnowledge = async () => {
    const e: Record<string, string> = {};
    if (!newQ.trim()) e.newQ = 'Pertanyaan wajib diisi';
    if (!newA.trim()) e.newA = 'Jawaban wajib diisi';
    setKnowledgeErrors(e);
    if (Object.keys(e).length > 0) return;
    await addKnowledgeMut.mutateAsync({ question: newQ, answer: newA, tags: newTags });
    setNewQ(''); setNewA(''); setNewTags(''); setKnowledgeErrors({});
  };

  const delKnowledge = async (id: number) => {
    if (!await swalConfirm('Hapus Q&A ini?')) return false;
    await deleteKnowledgeMut.mutateAsync(id);
    return true;
  };

  const generateKnowledge = async () => {
    const e: Record<string, string> = {};
    if (!genText.trim()) e.genText = 'Paste teks dulu untuk di-generate';
    setKnowledgeErrors(e);
    if (Object.keys(e).length > 0) return;
    try {
      await generateKnowledgeMut.mutateAsync({ text: genText, count: genCount });
      setGenText('');
    } catch {
      swalToast('Gagal generate knowledge', 'error');
    }
  };

  const dotColor = (s?: string) => (s === 'connected' ? '#25D366' : s === 'qr' || s === 'connecting' ? '#ffa726' : '#bdbdbd');

  const logout = () => { localStorage.clear(); window.location.href = '/login'; };
  const sc = status === 'connected' ? 'success' : status === 'qr' || status === 'connecting' ? 'warning' : 'error';
  const sl = status === 'connected' ? 'Online' : status === 'connecting' ? 'Menyambung…' : status === 'qr' ? 'Scan QR' : 'Offline';
  const currentAgent = agents.find(a => a.id === agentId);

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: '100vh', height: { md: '100vh' }, overflow: { md: 'hidden' }, bgcolor: 'background.default' }}>
      <Paper
        component="aside"
        sx={{
          width: { xs: '100%', md: 224 },
          flexShrink: 0,
          borderRadius: 0,
          p: { xs: 1, md: 1.25 },
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          position: { xs: 'sticky', md: 'static' },
          top: 0,
          zIndex: 10,
          height: { md: '100vh' },
          overflowY: { md: 'auto' },
          borderRight: { md: '1px solid' },
          borderBottom: { xs: '1px solid', md: 0 },
          borderColor: 'divider',
        }}
      >
        <Stack direction={{ xs: 'row', md: 'column' }} spacing={1} sx={{ alignItems: { xs: 'center', md: 'stretch' } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexShrink: 0 }}>
            <img src={logo} alt="ChatLoop" style={{ width: 40, height: 40, flexShrink: 0 }} />
            <Box sx={{ minWidth: 0, display: { xs: 'none', sm: 'block' } }}>
              <Typography sx={{ fontWeight: 800, fontSize: 14, lineHeight: 1.1 }}>ChatLoop</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', md: 'block' } }}>
                {user.name || user.username}
              </Typography>
            </Box>
          </Box>

          <FormControl size="small" sx={{ width: { xs: 158, md: '100%' }, flexShrink: 0 }}>
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

          <Button startIcon={<AddIcon />} onClick={createAgent} disabled={createAgentMut.isPending} sx={{ flexShrink: 0 }}>
            Tambah
          </Button>
          <IconButton aria-label="Logout" onClick={logout} color="error" sx={{ display: { xs: 'inline-flex', md: 'none' }, ml: 'auto' }}>
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Divider sx={{ display: { xs: 'none', md: 'block' } }} />

        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'row', md: 'column' },
            gap: 0.5,
            overflowX: { xs: 'auto', md: 'visible' },
            pb: { xs: 0.25, md: 0 },
            mx: { xs: -1, md: 0 },
            px: { xs: 1, md: 0 },
            scrollbarWidth: 'thin',
          }}
        >
          {NAV_ITEMS.map((item) => (
            <Button
              key={item.id}
              variant={tab === item.id ? 'contained' : 'text'}
              startIcon={item.icon}
              onClick={() => setTab(item.id)}
              sx={{
                justifyContent: { xs: 'center', md: 'flex-start' },
                minWidth: { xs: 'max-content', md: '100%' },
                height: 32,
                px: 1.1,
                color: tab === item.id ? 'primary.contrastText' : 'text.primary',
                '& .MuiButton-startIcon': { mr: 0.75 },
              }}
            >
              {item.label}
            </Button>
          ))}
        </Box>
        <Box sx={{ flex: 1, display: { xs: 'none', md: 'block' } }} />
        <Button startIcon={<LogoutIcon />} onClick={logout} color="error" sx={{ display: { xs: 'none', md: 'inline-flex' }, justifyContent: 'flex-start' }}>
          Logout
        </Button>
      </Paper>

      <Box component="main" sx={{ flex: 1, p: { xs: 1.25, md: 2 }, overflowY: 'auto', height: { md: '100vh' }, minHeight: 0, width: '100%', minWidth: 0 }}>
        {tab === 'dashboard' && (
          <Box>
            <PageHeader title={<>Dashboard {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>· {currentAgent.name}</Typography>}</>} />

            <Card sx={{ mb: 1.5, borderLeft: '4px solid', borderColor: aiEnabled ? 'success.main' : 'grey.400', bgcolor: aiEnabled ? 'rgba(37,211,102,0.07)' : 'action.hover' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <SmartToyIcon sx={{ fontSize: 30, color: aiEnabled ? 'success.main' : 'text.disabled', flexShrink: 0 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700 }}>Balasan Otomatis AI</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {aiEnabled
                        ? 'Aktif — chat pelanggan dibalas otomatis oleh AI.'
                        : 'Nonaktif — semua chat masuk Inbox untuk dibalas manual.'}
                    </Typography>
                  </Box>
                  <Stack sx={{ alignItems: 'center', flexShrink: 0 }}>
                    <Switch checked={aiEnabled} onChange={e => toggleAI(e.target.checked)} color="success" disabled={!agentId || saveAgentMut.isPending} />
                    <Typography variant="caption" sx={{ fontWeight: 800, color: aiEnabled ? 'success.main' : 'text.disabled' }}>
                      {aiEnabled ? 'ON' : 'OFF'}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card sx={{ mb: 1.5 }}>
              <CardContent sx={{ pb: 1.5 }}>
                <Grid container spacing={1.5} sx={{ alignItems: 'center' }}>
                  <Grid size={{ xs: 12, sm: 7 }}>
                    <Stack spacing={1.25}>
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', mb: 0.25, display: 'block' }}>
                          Langganan
                        </Typography>
                        <UsageCard />
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', mb: 0.25, display: 'block' }}>
                          WhatsApp
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Chip label={sl} color={sc} size="small" />
                          {status === 'connected' && waNumber ? (
                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {waName || 'Tanpa nama'} · +{waNumber}
                            </Typography>
                          ) : (
                            <Typography variant="body2" color="text.secondary">Belum tersambung</Typography>
                          )}
                        </Stack>
                      </Box>
                    </Stack>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 5 }}>
                    <Stack direction={{ xs: 'row', sm: 'column' }} spacing={1} sx={{ alignItems: { xs: 'center', sm: 'flex-end' } }}>
                      <Button variant="contained" size="small" onClick={connect} disabled={connectMut.isPending}
                        startIcon={connectMut.isPending ? <CircularProgress size={14} /> : <QrCodeIcon />}>
                        {status === 'connected' ? 'Reconnect' : 'Connect'}
                      </Button>
                      {status === 'connected' && (
                        <Button variant="outlined" size="small" color="error" onClick={disconnectWA} disabled={disconnectMut.isPending}
                          startIcon={disconnectMut.isPending ? <CircularProgress size={14} /> : <LogoutIcon />}>
                          Putuskan
                        </Button>
                      )}
                    </Stack>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
            {qr && (
              <Card sx={{ mb: 1.5, bgcolor: '#fff', textAlign: 'center' }}>
                <CardContent>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Scan QR Code di WhatsApp</Typography>
                  <QRCodeSVG value={qr} size={168} level="L" includeMargin />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Buka WhatsApp → Linked Devices → Scan
                  </Typography>
                </CardContent>
              </Card>
            )}
          </Box>
        )}

        {tab === 'knowledge' && (
          <Box>
            <PageHeader title={<>Knowledge Base {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>· {currentAgent.name}</Typography>}</>} />

            <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Card sx={{ height: '100%', borderColor: 'primary.main' }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                      <AutoAwesomeIcon sx={{ mr: 0.5, verticalAlign: 'middle', color: '#25D366', fontSize: 18 }} />
                      Generate dengan AI
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                      Paste teks/artikel, AI buatkan Q&A + tags otomatis.
                    </Typography>
                    <TextField multiline rows={3} fullWidth size="small" value={genText}
                      onChange={e => { setGenText(e.target.value); if (knowledgeErrors.genText) setKnowledgeErrors(p => ({...p, genText: ''})); }}
                      placeholder="Paste teks di sini..."
                      error={!!knowledgeErrors.genText} helperText={knowledgeErrors.genText}
                      sx={{ mb: 0.75 }} />
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <TextField type="number" size="small" label="Jumlah" value={genCount}
                        onChange={e => setGenCount(Number(e.target.value))} sx={{ width: 80 }} />
                      <Button variant="contained" size="small" onClick={generateKnowledge} disabled={generateKnowledgeMut.isPending}
                        startIcon={generateKnowledgeMut.isPending ? <CircularProgress size={14} /> : <AutoAwesomeIcon />}>
                        Generate
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Tambah Manual</Typography>
                    <Stack spacing={0.75}>
                      <TextField size="small" label="Pertanyaan" value={newQ}
                        onChange={e => { setNewQ(e.target.value); if (knowledgeErrors.newQ) setKnowledgeErrors(p => ({...p, newQ: ''})); }}
                        error={!!knowledgeErrors.newQ} helperText={knowledgeErrors.newQ} />
                      <TextField size="small" label="Jawaban" multiline rows={2} value={newA}
                        onChange={e => { setNewA(e.target.value); if (knowledgeErrors.newA) setKnowledgeErrors(p => ({...p, newA: ''})); }}
                        error={!!knowledgeErrors.newA} helperText={knowledgeErrors.newA} />
                      <TextField size="small" label="Tags (koma)" value={newTags} onChange={e => setNewTags(e.target.value)} />
                      <Button size="small" startIcon={<AddIcon />} variant="contained" onClick={addKnowledge} disabled={addKnowledgeMut.isPending}>Tambah</Button>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {(() => {
              const totalPages = Math.ceil(knowledge.length / KNOWLEDGE_PER_PAGE);
              const safePage = Math.min(knowledgePage, Math.max(0, totalPages - 1));
              const start = safePage * KNOWLEDGE_PER_PAGE;
              const pageItems = knowledge.slice(start, start + KNOWLEDGE_PER_PAGE);
              return (
                <>
                  {pageItems.map(k => (
                    <Card key={k.id} sx={{ mb: 0.75 }}>
                      <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.25 }}>Q: {k.question}</Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: k.tags ? 0.25 : 0 }}>A: {k.answer}</Typography>
                            {k.tags && <Chip label={k.tags} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />}
                          </Box>
                          <IconButton onClick={async () => { if (await delKnowledge(k.id) && pageItems.length === 1 && safePage > 0) setKnowledgePage(safePage - 1); }} size="small" color="error" sx={{ flexShrink: 0 }}><DeleteIcon fontSize="small" /></IconButton>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                  {totalPages > 1 && (
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', alignItems: 'center', mt: 1 }}>
                      <Button size="small" variant="outlined" disabled={safePage === 0}
                        onClick={() => setKnowledgePage(p => Math.max(0, p - 1))}>
                        ← Sebelumnya
                      </Button>
                      <Typography variant="caption" color="text.secondary">
                        {safePage + 1} / {totalPages}
                      </Typography>
                      <Button size="small" variant="outlined" disabled={safePage >= totalPages - 1}
                        onClick={() => setKnowledgePage(p => Math.min(totalPages - 1, p + 1))}>
                        Berikutnya →
                      </Button>
                    </Stack>
                  )}
                </>
              );
            })()}
          </Box>
        )}

        {tab === 'settings' && (
          <Box>
            <PageHeader title={<><SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />Pengaturan {currentAgent && <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>· {currentAgent.name}</Typography>}</>} />
            <Card sx={{ mb: 1.5 }}>
              <CardContent>
                <Box sx={{ mb: 1.5, p: 1.25, borderRadius: 1, border: '1px solid', borderColor: aiEnabled ? 'success.light' : 'divider', bgcolor: aiEnabled ? 'rgba(37,211,102,0.07)' : 'action.hover' }}>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <SmartToyIcon sx={{ color: aiEnabled ? 'success.main' : 'text.disabled', flexShrink: 0 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700 }}>Balasan Otomatis AI</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {aiEnabled
                          ? 'AI membalas chat pelanggan secara otomatis.'
                          : 'AI mati — chat masuk Inbox untuk dibalas manual. Sapaan & balasan kata kunci tetap jalan.'}
                      </Typography>
                    </Box>
                    <Switch checked={aiEnabled} onChange={e => toggleAI(e.target.checked)} color="success" disabled={saveAgentMut.isPending} />
                  </Stack>
                </Box>
                <Divider sx={{ mb: 1.5 }} />

                <Grid container spacing={1.5} sx={{ mb: 1.5 }}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Nama CS</Typography>
                    <TextField fullWidth size="small" value={agentName}
                      onChange={e => { setAgentName(e.target.value); if (settingsErrors.agentName) setSettingsErrors(p => ({...p, agentName: ''})); }}
                      error={!!settingsErrors.agentName} helperText={settingsErrors.agentName} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Tone / Gaya Bahasa</Typography>
                    <FormControl fullWidth size="small">
                      <InputLabel>Tone</InputLabel>
                      <Select value={tone} label="Tone" onChange={e => setTone(e.target.value)}>
                        {TONES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>

                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>System Prompt — Persona <Typography component="span" variant="caption" color="text.secondary">(opsional)</Typography></Typography>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                  Identitas, peran, batasan bot. Kalau dikosongkan, AI tetap bisa menjawab pakai knowledge base + tone. Contoh: "Kamu admin Sedekah Bekas di Yogyakarta. Bantu donasi. Jangan bahas di luar topik."
                </Typography>
                <TextField multiline rows={3} fullWidth size="small" value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder='Opsional. Contoh: Kamu admin "Toko Maju Jaya", jual sparepart motor. Bantu pelanggan soal stok, harga, & cara order.'
                  sx={{ mb: 1.5 }} />

                <Divider sx={{ mb: 1.5 }} />

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Sapaan Otomatis</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                      Pesan pembuka sekali saat kontak baru pertama chat.
                    </Typography>
                    <FormControlLabel control={<Switch checked={greetEnabled} onChange={e => setGreetEnabled(e.target.checked)} />} label="Aktifkan" />
                    <TextField fullWidth multiline rows={2} size="small" label="Pesan sapaan" value={greetMsg}
                      onChange={e => setGreetMsg(e.target.value)} disabled={!greetEnabled} sx={{ mt: 0.75 }}
                      placeholder="Halo kak! Ada yang bisa dibantu? 😊" />
                  </Grid>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Jam Kerja</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block' }}>
                      Di luar jam kerja bot tidak jawab pakai AI, hanya kirim pesan otomatis sekali.
                    </Typography>
                    <FormControlLabel control={<Switch checked={bhEnabled} onChange={e => setBhEnabled(e.target.checked)} />} label="Batasi jam kerja" />
                    <Stack direction="row" spacing={1} sx={{ my: 0.75 }}>
                      <TextField type="time" label="Mulai" size="small" value={bhStart} onChange={e => setBhStart(e.target.value)}
                        disabled={!bhEnabled} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
                      <TextField type="time" label="Selesai" size="small" value={bhEnd} onChange={e => setBhEnd(e.target.value)}
                        disabled={!bhEnabled} slotProps={{ inputLabel: { shrink: true } }} sx={{ flex: 1 }} />
                    </Stack>
                    <TextField fullWidth multiline rows={2} size="small" label="Pesan di luar jam kerja" value={awayMsg}
                      onChange={e => setAwayMsg(e.target.value)} disabled={!bhEnabled}
                      placeholder="Mohon maaf, kami sedang di luar jam operasional. Pesan kakak akan kami balas pada jam kerja ya 🙏" />
                  </Grid>
                </Grid>

                <Button variant="contained" onClick={saveAgent} disabled={saveAgentMut.isPending} sx={{ mt: 1.5 }}>{saved ? 'Tersimpan ✓' : saveAgentMut.isPending ? 'Menyimpan…' : 'Simpan'}</Button>
              </CardContent>
            </Card>

            <Card sx={{ border: '1px solid #f5c2c7' }}>
              <CardContent>
                <Typography variant="subtitle2" color="error" sx={{ mb: 1 }}>Zona Berbahaya</Typography>
                <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={deleteAgent} disabled={deleteAgentMut.isPending}>Hapus CS ini</Button>
              </CardContent>
            </Card>
          </Box>
        )}

        {tab === 'langganan' && <BillingPanel />}
        {tab === 'inbox' && <InboxPanel agentId={agentId} seed={seed?.kind === 'inbox' ? seed : null} />}
        {tab === 'coba-chat' && <TestChatPanel agentId={agentId} />}
        {tab === 'broadcast' && <BroadcastPanel agentId={agentId} seed={seed?.kind === 'broadcast' ? seed : null} />}
        {tab === 'kalender' && <CalendarPanel agentId={agentId} />}
        {tab === 'auto-reply' && <AutoReplyPanel agentId={agentId} />}
        {tab === 'template' && <TemplatePanel agentId={agentId} />}
        {tab === 'follow-up' && <FollowUpPanel agentId={agentId} />}
        {tab === 'kontak' && (
          <ContactsPanel agentId={agentId}
            onBroadcast={(recipients) => { setSeed({ kind: 'broadcast', value: recipients, n: Date.now() }); setTab('broadcast'); }}
            onOpenChat={(number) => { setSeed({ kind: 'inbox', value: number, n: Date.now() }); setTab('inbox'); }} />
        )}
      </Box>
    </Box>
  );
}
