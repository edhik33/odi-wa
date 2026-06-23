import { useState } from 'react';
import { TextField, Button, Stack, Typography, Menu, MenuItem, CircularProgress, Box } from '@mui/material';
import ForumIcon from '@mui/icons-material/ForumOutlined';
import ContactsIcon from '@mui/icons-material/ContactsOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import LabelIcon from '@mui/icons-material/LabelOutlined';
import { useChatContacts, useWAContacts, useGroups, useGroupMembers, useLabels, useLabelContacts } from '../hooks';
import { normalizePhone } from '../types';
import type { WAGroup, LabelInfo } from '../types';

type Contact = { number: string; name: string };

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
