import { useState, useEffect, useRef } from 'react';
import {
  Box, Typography, Card, List, ListItemButton, ListItemText, TextField, IconButton,
  Stack, Chip, Button, Divider, CircularProgress, Avatar,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import ReplyIcon from '@mui/icons-material/Reply';
import { useContacts, useConversation, useSendMessage, useSendMedia, useSendTyping, useRevokeMessage, useResumeBot } from '../hooks';
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

function Bubble({ side, bg, color, tag, time, name, replyTo, onReply, children }: {
  side: 'left' | 'right'; bg: string; color?: string; tag?: string; time?: string; name?: string;
  replyTo?: string; onReply?: () => void; children: React.ReactNode;
}) {
  const isLeft = side === 'left';
  const initial = name ? name.charAt(0).toUpperCase() : (tag === 'CS' ? 'CS' : '?');
  return (
    <Box sx={{
      alignSelf: isLeft ? 'flex-start' : 'flex-end',
      maxWidth: { xs: '86%', md: '68%' },
      display: 'flex',
      flexDirection: isLeft ? 'row' : 'row-reverse',
      alignItems: 'flex-end',
      gap: 0.5,
      '&:hover .reply-btn': { opacity: 1 },
    }}>
      <Avatar sx={{
        width: 26, height: 26, fontSize: 11, fontWeight: 700, flexShrink: 0,
        bgcolor: tag === 'Bot' ? '#25D366' : tag === 'CS' ? 'primary.main' : 'grey.500',
        color: '#fff',
      }}>
        {tag === 'Bot' ? <SmartToyIcon sx={{ fontSize: 15 }} /> : initial}
      </Avatar>

      <Box sx={{ position: 'relative' }}>
        {/* Tag — hanya label kecil di atas bubble kanan */}
        {tag && (
          <Typography variant="caption" sx={{
            display: 'block', textAlign: 'right', mb: 0.15,
            fontWeight: 600, fontSize: 9, color: 'text.disabled',
            letterSpacing: 0.3,
          }}>
            {tag}
          </Typography>
        )}

        {/* Bubble body */}
        <Box sx={{
          px: 1.25, py: 0.6, borderRadius: '10px',
          borderTopRightRadius: !isLeft && !tag ? '4px' : '10px',
          borderTopLeftRadius: isLeft && !time ? '4px' : '10px',
          bgcolor: bg, color: color || 'text.primary',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontSize: '0.88rem', lineHeight: 1.38,
          boxShadow: '0 1px 1px rgba(0,0,0,0.06)',
        }}>
          {/* Reply quote indicator */}
          {replyTo && (
            <Box sx={{
              borderLeft: '3px solid', borderColor: isLeft ? 'grey.400' : 'rgba(255,255,255,0.5)',
              pl: 1, py: 0.3, mb: 0.4, opacity: 0.85,
              fontSize: '0.78rem', lineHeight: 1.3, color: isLeft ? 'text.secondary' : 'inherit',
            }}>
              {replyTo}
            </Box>
          )}
          {children}
        </Box>

        {/* Timestamp + reply inline */}
        <Stack direction="row" spacing={0.5} sx={{
          justifyContent: isLeft ? 'flex-start' : 'flex-end',
          alignItems: 'center', mt: 0.15,
        }}>
          {time && (
            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled' }}>
              {time}
            </Typography>
          )}
          <IconButton
            size="small"
            className="reply-btn"
            onClick={onReply}
            sx={{ opacity: 0, transition: 'opacity 0.15s', p: 0.2, width: 16, height: 16 }}
          >
            <ReplyIcon sx={{ fontSize: 12 }} />
          </IconButton>
        </Stack>
      </Box>
    </Box>
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
  const revokeMsg = useRevokeMessage(agentId);
  const sendMsg = useSendMessage(agentId);
  const sendMedia = useSendMedia(agentId);
  const sendTyping = useSendTyping(agentId);
  const resumeBot = useResumeBot(agentId);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; text: string } | null>(null);
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
    await sendMsg.mutateAsync({ to: sender, message: m, reply_to: replyTo?.id || '', reply_text: replyTo?.text || '' } as any);
    setReplyTo(null);
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
                      <Bubble side="left" bg="#fff" time={fmtTime(m.created_at)} name={selectedName || sender}
                        replyTo={m.reply_text || (m.reply_to ? (convo?.data?.find((x: any) => x.wa_msg_id === m.reply_to || String(x.id) === m.reply_to)?.message || '💬 Pesan...') : '')}
                        onReply={() => setReplyTo({ id: m.wa_msg_id || String(m.id), text: ((m: any) => {
    if (m.message) return m.message;
    if (m.media_type === 'image' || m.media_type === 'sticker') return '📷 Foto';
    if (m.media_type === 'video') return '🎥 Video';
    if (m.media_type === 'audio') return '🎵 Audio';
    if (m.media_type === 'document') return '📄 ' + (m.file_name || 'Dokumen');
    return '📷 Media';
  })(m) })}>
                        {m.media_type && !m.from_human && <MediaView agentId={agentId} m={m} token={convo?.media_token || ''} />}
                        {m.message && <span>{m.message}</span>}
                      </Bubble>
                    )}
                    {/* Balasan CS / Bot (kanan) */}
                    {(m.reply || (m.media_type && m.from_human)) && (
                      <>
                      <Bubble
                        side="right"
                        bg={m.from_human ? '#1F8A50' : '#dcf8c6'}
                        color={m.from_human ? '#fff' : 'inherit'}
                        tag={m.from_human ? 'CS' : 'Bot'}
                        time={fmtTime(m.created_at)}
                        replyTo={m.reply_text || (m.reply_to ? (convo?.data?.find((x: any) => x.wa_msg_id === m.reply_to || String(x.id) === m.reply_to)?.reply || convo?.data?.find((x: any) => x.wa_msg_id === m.reply_to || String(x.id) === m.reply_to)?.message || '💬 Pesan...') : '')}
                        onReply={() => setReplyTo({ id: m.wa_msg_id || String(m.id), text: m.reply || m.message || '📷 Media' })}
                      >
                        {m.media_type && m.from_human && <MediaView agentId={agentId} m={m} token={convo?.media_token || ''} />}
                        {m.reply && <span>{m.reply}</span>}
                      </Bubble>
                      {m.from_human && (
                        <IconButton size="small" onClick={() => revokeMsg.mutate({ msgId: m.wa_msg_id || String(m.id), to: sender })}
                          sx={{ alignSelf: 'flex-end', opacity: 0, '&:hover': { opacity: 1 }, p: 0.2, width: 18, height: 18, mt: -3, mr: -1 }}>
                          <DeleteIcon sx={{ fontSize: 14, color: 'error.main' }} />
                        </IconButton>
                      )}
                      </>
                    )}
                  </Box>
                ))}
                {/* Typing indicator — muncul saat sedang mengirim */}
                {busy && <TypingIndicator />}
                <div ref={bottomRef} />
              </Box>
              <Divider />
              {/* Reply quote bar */}
              {replyTo && (
                <Stack direction="row" sx={{ px: 1.25, pt: 1, alignItems: 'center', gap: 1, bgcolor: '#f0f4f0', borderLeft: '3px solid', borderColor: 'primary.main' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Balas: {replyTo.text.slice(0, 80)}{replyTo.text.length > 80 ? '…' : ''}
                  </Typography>
                  <IconButton size="small" onClick={() => setReplyTo(null)}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
                </Stack>
              )}
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
                  onChange={e => { setText(e.target.value); if (sender) { clearTimeout(typingTimer.current); sendTyping.mutate({ to: sender, active: true }); typingTimer.current = setTimeout(() => sendTyping.mutate({ to: sender, active: false }), 5000); } }} onKeyDown={e => e.key === 'Enter' && send()} onBlur={() => { if (sender) sendTyping.mutate({ to: sender, active: false }); }}
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
