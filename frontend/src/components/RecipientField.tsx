import { useState } from 'react';
import { TextField, Button, Stack, Typography, Menu, MenuItem, CircularProgress, Box, IconButton, InputAdornment } from '@mui/material';
import ForumIcon from '@mui/icons-material/ForumOutlined';
import ContactsIcon from '@mui/icons-material/ContactsOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import LabelIcon from '@mui/icons-material/LabelOutlined';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import { useChatContacts, useWAContacts, useGroups, useGroupMembers, useLabels, useLabelContacts } from '../hooks';
import { normalizePhone } from '../types';
import type { WAGroup, LabelInfo } from '../types';

type Contact = { number: string; name: string };

const PREVIEW_CAP = 300; // batas baris yang dirender agar daftar besar tetap ringan

export default function RecipientField({ agentId, value, onChange, error }: {
  agentId: number; value: string; onChange: (v: string) => void; error?: string;
}) {
  const chatContacts = useChatContacts(agentId);
  const waContacts = useWAContacts(agentId);
  const groups = useGroups(agentId);
  const groupMembers = useGroupMembers(agentId);
  const labels = useLabels(agentId);
  const labelContacts = useLabelContacts(agentId);

  const [note, setNote] = useState('');
  const [groupList, setGroupList] = useState<WAGroup[]>([]);
  const [labelList, setLabelList] = useState<LabelInfo[]>([]);
  const [groupAnchor, setGroupAnchor] = useState<null | HTMLElement>(null);
  const [labelAnchor, setLabelAnchor] = useState<null | HTMLElement>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [filter, setFilter] = useState('');

  // Parse isi kotak jadi daftar penerima (nomor dinormalkan), buang duplikat & baris tak valid.
  const rawLines = value.split('\n').map(l => l.trim()).filter(Boolean);
  const dedup = new Map<string, string>();
  let invalid = 0;
  for (const line of rawLines) {
    const [num, ...rest] = line.split(',');
    const number = normalizePhone(num);
    if (!number) { invalid++; continue; }
    if (!dedup.has(number)) dedup.set(number, rest.join(',').trim());
  }
  const recipients: Contact[] = Array.from(dedup.entries()).map(([number, name]) => ({ number, name }));
  const dupCount = rawLines.length - invalid - recipients.length;

  const f = filter.trim().toLowerCase();
  const filtered = f ? recipients.filter(r => r.name.toLowerCase().includes(f) || r.number.includes(f)) : recipients;
  const shown = filtered.slice(0, PREVIEW_CAP);
  const capped = filtered.length - shown.length;

  const removeNumber = (num: string) => {
    const kept = rawLines.filter(line => normalizePhone(line.split(',')[0]) !== num);
    onChange(kept.join('\n'));
  };
  const clearAll = () => { onChange(''); setNote(''); setFilter(''); };

  const merge = (list: Contact[], label: string) => {
    const parsed = value.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const [num, ...rest] = line.split(',');
      return { number: normalizePhone(num), name: rest.join(',').trim() };
    }).filter(r => r.number);
    const map = new Map<string, string>();
    [...parsed, ...list.map(c => ({ number: normalizePhone(c.number), name: c.name || '' }))]
      .forEach(c => { if (c.number && !map.has(c.number)) map.set(c.number, c.name); });
    onChange(Array.from(map.entries()).map(([n, nm]) => (nm ? `${n},${nm}` : n)).join('\n'));
    setNote(`${list.length} kontak dari ${label} ditambahkan.`);
  };

  const openGroups = async (e: React.MouseEvent<HTMLElement>) => {
    const target = e.currentTarget;
    try { const g = await groups.mutateAsync(); setGroupList(g); setGroupAnchor(target); }
    catch { setNote('Gagal ambil grup (WhatsApp tersambung?).'); }
  };
  const openLabels = async (e: React.MouseEvent<HTMLElement>) => {
    const target = e.currentTarget;
    try { const l = await labels.mutateAsync(); setLabelList(l); setLabelAnchor(target); }
    catch { setNote('Gagal ambil label.'); }
  };

  return (
    <Box>
      <TextField fullWidth multiline rows={4} value={value} onChange={e => onChange(e.target.value)}
        placeholder={'08123456789,Budi\n08987654321,Sinta'} error={!!error} helperText={error} sx={{ mb: 1 }} />
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.75, mb: 0.5 }}>
        <Button size="small" disabled={chatContacts.isPending}
          startIcon={chatContacts.isPending ? <CircularProgress size={14} /> : <ForumIcon />}
          onClick={async () => merge(await chatContacts.mutateAsync(), 'pernah chat')}>
          Pernah chat
        </Button>
        <Button size="small" color="warning" disabled={waContacts.isPending}
          startIcon={waContacts.isPending ? <CircularProgress size={14} /> : <ContactsIcon />}
          onClick={async () => merge(await waContacts.mutateAsync(), 'kontak WhatsApp')}>
          Sinkron WA
        </Button>
        <Button size="small" disabled={groups.isPending}
          startIcon={groups.isPending ? <CircularProgress size={14} /> : <GroupsIcon />}
          onClick={openGroups}>
          Dari grup
        </Button>
        <Button size="small" disabled={labels.isPending}
          startIcon={labels.isPending ? <CircularProgress size={14} /> : <LabelIcon />}
          onClick={openLabels}>
          Dari label
        </Button>
      </Stack>
      {note && <Typography variant="caption" color="success.main" sx={{ display: 'block' }}>{note}</Typography>}

      {/* Pratinjau daftar target */}
      {recipients.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'success.main' }}>
              ✓ {recipients.length} nomor valid
            </Typography>
            {dupCount > 0 && <Typography variant="caption" color="text.secondary">· {dupCount} duplikat digabung</Typography>}
            {invalid > 0 && <Typography variant="caption" color="warning.main">· {invalid} baris tak valid</Typography>}
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="error" sx={{ cursor: 'pointer', fontWeight: 600 }} onClick={clearAll}>Kosongkan</Typography>
            <Typography variant="caption" color="primary" sx={{ cursor: 'pointer', fontWeight: 600 }}
              onClick={() => setShowPreview(v => !v)}>
              {showPreview ? 'Sembunyikan' : 'Tampilkan'}
            </Typography>
          </Stack>

          {showPreview && (
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5 }}>
              {recipients.length > 8 && (
                <TextField size="small" fullWidth placeholder="Cari nama atau nomor…" value={filter}
                  onChange={e => setFilter(e.target.value)} sx={{ mb: 0.5 }}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }} />
              )}
              <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                {shown.length === 0 ? (
                  <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>Tidak ada yang cocok.</Typography>
                ) : shown.map(r => (
                  <Stack key={r.number} direction="row" sx={{ alignItems: 'center', gap: 1, px: 1, py: 0.4, borderRadius: 0.5, '&:hover': { bgcolor: 'action.hover' } }}>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name ? <>{r.name} <Typography component="span" variant="caption" color="text.secondary">· {r.number}</Typography></> : r.number}
                    </Typography>
                    <IconButton size="small" aria-label="Hapus nomor" onClick={() => removeNumber(r.number)} sx={{ p: 0.25 }}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Stack>
                ))}
                {capped > 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: 'block' }}>
                    … dan {capped} lainnya. Pakai kotak cari untuk mempersempit.
                  </Typography>
                )}
              </Box>
            </Box>
          )}
        </Box>
      )}

      <Menu anchorEl={groupAnchor} open={!!groupAnchor} onClose={() => setGroupAnchor(null)}>
        {groupList.length === 0 && <MenuItem disabled>Tidak ada grup</MenuItem>}
        {groupList.map(g => (
          <MenuItem key={g.jid} onClick={async () => { setGroupAnchor(null); merge(await groupMembers.mutateAsync(g.jid), `grup ${g.name}`); }}>
            {g.name || g.jid} · {g.participants} anggota
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={labelAnchor} open={!!labelAnchor} onClose={() => setLabelAnchor(null)}>
        {labelList.length === 0 && <MenuItem disabled>Tidak ada label (akun Business?)</MenuItem>}
        {labelList.map(l => (
          <MenuItem key={l.label_id} onClick={async () => { setLabelAnchor(null); merge(await labelContacts.mutateAsync(l.label_id), `label ${l.name}`); }}>
            {l.name} · {l.count} kontak
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
