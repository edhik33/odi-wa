import { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Card, List, ListItemButton, ListItemText, TextField, IconButton,
  Stack, Chip, Button, Divider, CircularProgress, Avatar,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import { useContacts, useConversation, useSendMessage, useSendMedia, useResumeBot } from '../hooks';
import PageHeader from './PageHeader';
import TemplatePicker from './TemplatePicker';
import type { ChatMsg } from '../types';

function MediaView({ agentId, m, token }: { agentId: number; m: ChatMsg; token: string }) {
  const url = `/api/agents/${agentId}/media/${m.id}?token=${token}`;
  if (m.media_type === 'image' || m.media_type === 'sticker')
    return <img src={url} alt="" style={{ maxWidth: 200, borderRadius: 8, display: 'block' }} />;
  if (m.media_type === 'audio') return <audio src={url} controls style={{ maxWidth: 220 }} />;
  if (m.media_type === 'video') return <video src={url} controls style={{ maxWidth: 220, borderRadius: 8 }} />;
  return <a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>📎 {m.file_name || 'Unduh file'}</a>;
}

function fmtTime(ts?: string) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function Bubble({ side, bg, color, tag, time, name, children }: {
  side: 'left' | 'right'; bg: string; color?: string; tag?: string; time?: string; name?: string; children: React.ReactNode;
}) {
  const isLeft = side === 'left';
  const initial = name ? name.charAt(0).toUpperCase() : (tag === 'CS' ? 'CS' : '?');
  return (
    <Stack direction="row" spacing={0.75} sx={{
      alignSelf: isLeft ? 'flex-start' : 'flex-end',
      maxWidth: { xs: '88%', md: '74%' },
      flexDirection: isLeft ? 'row' : 'row-reverse',
    }}>
      <Avatar sx={{
        width: 28, height: 28, fontSize: 12, fontWeight: 700, flexShrink: 0,
        bgcolor: tag === 'Bot' ? '#25D366' : tag === 'CS' ? 'primary.main' : 'grey.600',
        color: '#fff',
        alignSelf: 'flex-end',
      }}>
        {tag === 'Bot' ? <SmartToyIcon sx={{ fontSize: 16 }} /> : initial}
      </Avatar>

      <Box>
        {/* Tag label */}
        {tag && (
          <Typography variant="caption" color="text.secondary" sx={{
            display: 'block', textAlign: isLeft ? 'left' : 'right', mb: 0.25,
            fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {tag}
          </Typography>
        )}

        {/* Bubble */}
        <Box sx={{
          px: 1.5, py: 0.75, borderRadius: 1.5,
          bgcolor: bg, color: color || 'text.primary',
          whiteSpace: 'pre-wrap',
          boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          fontSize: '0.88rem', lineHeight: 1.45,
        }}>
          {children}
        </Box>

        {/* Timestamp */}
        {time && (
          <Typography variant="caption" color="text.disabled" sx={{
            display: 'block', textAlign: isLeft ? 'left' : 'right',
            mt: 0.25, fontSize: 10,
          }}>
            {time}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function TypingIndicator() {
  return (
    <Box sx={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 1, bgcolor: '#fff', borderRadius: 1.5, boxShadow: '0 1px 2px rgba(0,0,0,0.08)', maxWidth: 80 }}>
      {[0, 1, 2].map(i => (
        <Box key={i} sx={{
          width: 7, height: 7, borderRadius: '50%', bgcolor: 'grey.400',
          animation: 'typingBounce 1.4s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
      <style>{`@keyframes typingBounce { 0%,60%,100%{transform:translateY(0);opacity:0.4} 30%{transform:translateY(-6px);opacity:1} }`}</style>
    </Box>
  );
}

export default function InboxPanel({ agentId, aiEnabled, seed }: { agentId: number; aiEnabled: boolean; seed?: { value: string; n: number } | null }) {
  const { data: contacts, isLoading } = useContacts(agentId);
  const [sender, setSender] = useState('');
  const { data: convo } = useConversation(agentId, sender);
  const sendMsg = useSendMessage(agentId);
  const sendMedia = useSendMedia(agentId);
  const resumeBot = useResumeBot(agentId);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const didFirstScroll = useRef(false);

  useEffect(() => {
    if (!sender && contacts && contacts.length) setSender(contacts[0].sender);
  }, [contacts, sender]);

  useEffect(() => { if (seed?.value) setSender(seed.value); }, [seed?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset scroll flag tiap ganti kontak.
  useEffect(() => {
    didFirstScroll.current = false;
  }, [sender]);

  // Data refresh: load pertama atau ganti kontak → scroll ke bawah.
  // Pesan baru (data refresh) → cuma scroll kalau user dekat bawah.
  useEffect(() => {
    const el = chatRef.current;
    if (!el || !convo) return;
    // Pakai setTimeout biar DOM udah ke-render dulu sebelum scroll.
    setTimeout(() => {
      if (!el) return;
      if (!didFirstScroll.current) {
        el.scrollTop = el.scrollHeight;
        didFirstScroll.current = true;
      } else {
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }, 50);
  }, [convo]);

  const busy = sendMsg.isPending || sendMedia.isPending;
  const selectedName = contacts?.find(ct => ct.sender === sender)?.name;

  const send = async () => {
    if (!sender || busy) return;
    if (file) {
      await sendMedia.mutateAsync({ to: sender, file, caption: text.trim() });
      setFile(null); setText('');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    const m = text.trim();
    if (!m) return;
    setText('');
    await sendMsg.mutateAsync({ to: sender, message: m });
  };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <PageHeader title="Inbox"
        subtitle="Baca dan balas pelanggan langsung dari sini. Saat kamu mengetik balasan, bot otomatis berhenti untuk kontak itu." />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ height: { md: 540 } }}>
        <Card sx={{ width: { xs: '100%', md: 280 }, flexShrink: 0, overflowY: 'auto' }}>
          <List dense disablePadding>
            {contacts?.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>Belum ada percakapan.</Typography>}
            {contacts?.map(ct => (
              <ListItemButton key={ct.sender} selected={ct.sender === sender} onClick={() => setSender(ct.sender)}>
                <Avatar sx={{ width: 32, height: 32, fontSize: 13, fontWeight: 700, mr: 1, bgcolor: 'grey.600', color: '#fff' }}>
                  {(ct.name || ct.sender).charAt(0).toUpperCase()}
                </Avatar>
                <ListItemText
                  primary={<Typography sx={{ fontWeight: 600, fontSize: 14 }}>{ct.name || `+${ct.sender}`}</Typography>}
                  secondary={
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180, mt: 0.25 }}>
                      {(ct as any).last_msg || `${ct.name ? `+${ct.sender} · ` : ''}${new Date(ct.last_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </Typography>
                  }
                />
                {ct.needs_human && <Chip label="Perlu kamu" size="small" color="warning" />}
              </ListItemButton>
            ))}
          </List>
        </Card>

        <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 380 }}>
          {!sender ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography color="text.secondary">Pilih kontak untuk melihat percakapan.</Typography>
            </Box>
          ) : (
            <>
              <Stack direction="row" sx={{ p: 1.25, alignItems: 'center', justifyContent: 'space-between' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Avatar sx={{ width: 36, height: 36, fontSize: 14, fontWeight: 700, bgcolor: 'grey.600', color: '#fff' }}>
                    {(selectedName || sender).charAt(0).toUpperCase()}
                  </Avatar>
                  <Box>
                    <Typography sx={{ fontWeight: 700 }}>{selectedName || `+${sender}`}</Typography>
                    {selectedName && <Typography variant="caption" color="text.secondary">+{sender}</Typography>}
                  </Box>
                </Stack>
                {!aiEnabled ? (
                  <Chip label="AI nonaktif" size="small" color="default" variant="outlined" />
                ) : convo?.needs_human ? (
                  <Button size="small" startIcon={<SmartToyIcon />} onClick={() => resumeBot.mutate(sender)} disabled={resumeBot.isPending}>Aktifkan bot</Button>
                ) : (
                  <Chip label="Bot aktif" size="small" color="success" variant="outlined" />
                )}
              </Stack>
              <Divider />
              <Box ref={chatRef} sx={{ flex: 1, overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, bgcolor: '#f7f9fa' }}>
                {convo?.data.map(m => (
                  <Box key={m.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {/* Pesan dari pelanggan (kiri) */}
                    {(m.message || (m.media_type && !m.from_human)) && (
                      <Bubble side="left" bg="#fff" time={fmtTime(m.created_at)} name={selectedName || sender}>
                        {m.media_type && !m.from_human && <MediaView agentId={agentId} m={m} token={convo?.media_token || ''} />}
                        {m.message && <span>{m.message}</span>}
                      </Bubble>
                    )}
                    {/* Balasan CS / Bot (kanan) */}
                    {(m.reply || (m.media_type && m.from_human)) && (
                      <Bubble
                        side="right"
                        bg={m.from_human ? '#1F8A50' : '#dcf8c6'}
                        color={m.from_human ? '#fff' : 'inherit'}
                        tag={m.from_human ? 'CS' : 'Bot'}
                        time={fmtTime(m.created_at)}
                      >
                        {m.media_type && m.from_human && <MediaView agentId={agentId} m={m} token={convo?.media_token || ''} />}
                        {m.reply && <span>{m.reply}</span>}
                      </Bubble>
                    )}
                  </Box>
                ))}
                {/* Typing indicator — muncul saat sedang mengirim */}
                {busy && <TypingIndicator />}
                <div ref={bottomRef} />
              </Box>
              <Divider />
              {file && (
                <Stack direction="row" sx={{ px: 1.25, pt: 1, alignItems: 'center', gap: 1 }}>
                  <Chip label={`📎 ${file.name}`} size="small" onDelete={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }} deleteIcon={<CloseIcon />} />
                  <Typography variant="caption" color="text.secondary">caption opsional di kolom bawah</Typography>
                </Stack>
              )}
              <Stack direction="row" spacing={1} sx={{ p: 1.25, alignItems: 'center' }}>
                <input ref={fileInput} type="file" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
                <IconButton onClick={() => fileInput.current?.click()}><AttachFileIcon /></IconButton>
                <TemplatePicker agentId={agentId} variant="text"
                  onPick={b => { const filled = b.replace(/\{nama\}/g, selectedName || 'kak'); setText(t => t ? t + ' ' + filled : filled); }} />
                <TextField fullWidth size="small" placeholder={file ? 'Caption (opsional)…' : 'Balas pelanggan…'} value={text}
                  onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
                  inputRef={inputRef}
                  sx={{
                    '& .MuiInputBase-root': { borderRadius: 2.5 },
                    '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } },
                    '& .MuiInputBase-input::after': {
                      content: '""', display: 'inline-block', width: 1, height: 16,
                      bgcolor: 'primary.main', ml: 0.25, verticalAlign: 'middle',
                      animation: 'blink 1s step-end infinite',
                    },
                  }}
                />
                <IconButton color="primary" onClick={send} disabled={busy}>
                  {busy ? <CircularProgress size={20} /> : <SendIcon />}
                </IconButton>
              </Stack>
            </>
          )}
        </Card>
      </Stack>
    </Box>
  );
}
