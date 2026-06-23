import { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Card, List, ListItemButton, ListItemText, TextField, IconButton,
  Stack, Chip, Button, Divider, CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import { useContacts, useConversation, useSendMessage, useSendMedia, useResumeBot } from '../hooks';
import PageHeader from './PageHeader';
import type { ChatMsg } from '../types';

function MediaView({ agentId, m, token }: { agentId: number; m: ChatMsg; token: string }) {
  const url = `/api/agents/${agentId}/media/${m.id}?token=${token}`;
  if (m.media_type === 'image' || m.media_type === 'sticker')
    return <img src={url} alt="" style={{ maxWidth: 200, borderRadius: 8, display: 'block' }} />;
  if (m.media_type === 'audio') return <audio src={url} controls style={{ maxWidth: 220 }} />;
  if (m.media_type === 'video') return <video src={url} controls style={{ maxWidth: 220, borderRadius: 8 }} />;
  return <a href={url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>📎 {m.file_name || 'Unduh file'}</a>;
}

function Bubble({ side, bg, color, tag, children }: {
  side: 'left' | 'right'; bg: string; color?: string; tag?: string; children: React.ReactNode;
}) {
  return (
    <Box sx={{ alignSelf: side === 'right' ? 'flex-end' : 'flex-start', maxWidth: { xs: '86%', md: '74%' } }}>
      {tag && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right' }}>{tag}</Typography>}
      <Box sx={{ px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: bg, color: color || 'text.primary', whiteSpace: 'pre-wrap', boxShadow: '0 1px 1px rgba(0,0,0,0.08)', fontSize: '0.88rem', lineHeight: 1.45 }}>
        {children}
      </Box>
    </Box>
  );
}

export default function InboxPanel({ agentId }: { agentId: number }) {
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

  useEffect(() => {
    if (!sender && contacts && contacts.length) setSender(contacts[0].sender);
  }, [contacts, sender]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [convo]);

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
                <ListItemText
                  primary={<Typography sx={{ fontWeight: 600 }}>{ct.name || `+${ct.sender}`}</Typography>}
                  secondary={`${ct.name ? `+${ct.sender} · ` : ''}${new Date(ct.last_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
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
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>{selectedName || `+${sender}`}</Typography>
                  {selectedName && <Typography variant="caption" color="text.secondary">+{sender}</Typography>}
                </Box>
                {convo?.needs_human ? (
                  <Button size="small" startIcon={<SmartToyIcon />} onClick={() => resumeBot.mutate(sender)} disabled={resumeBot.isPending}>Aktifkan bot</Button>
                ) : (
                  <Chip label="Bot aktif" size="small" color="success" variant="outlined" />
                )}
              </Stack>
              <Divider />
              <Box sx={{ flex: 1, overflowY: 'auto', p: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75, bgcolor: '#f7f9fa' }}>
                {convo?.data.map(m => (
                  <Box key={m.id} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {(m.message || (m.media_type && !m.from_human)) && (
                      <Bubble side="left" bg="#fff">
                        {m.media_type && !m.from_human && <MediaView agentId={agentId} m={m} token={convo?.media_token || ''} />}
                        {m.message && <span>{m.message}</span>}
                      </Bubble>
                    )}
                    {(m.reply || (m.media_type && m.from_human)) && (
                      <Bubble side="right" bg={m.from_human ? '#1F8A50' : '#dcf8c6'} color={m.from_human ? '#fff' : 'inherit'} tag={m.from_human ? 'CS' : 'Bot'}>
                        {m.media_type && m.from_human && <MediaView agentId={agentId} m={m} token={convo?.media_token || ''} />}
                        {m.reply && <span>{m.reply}</span>}
                      </Bubble>
                    )}
                  </Box>
                ))}
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
                <TextField fullWidth size="small" placeholder={file ? 'Caption (opsional)…' : 'Balas pelanggan…'} value={text}
                  onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
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
