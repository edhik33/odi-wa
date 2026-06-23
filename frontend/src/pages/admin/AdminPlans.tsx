import { useState } from 'react';
import {
  Box, Button, Card, CardContent, Table, TableBody, TableCell, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControlLabel, Switch, Chip,
  IconButton, Stack, CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useAdminPlans, useSavePlan, useDeletePlan } from '../../hooks';
import { swalConfirm } from '../../services/swal';
import type { Plan } from '../../types';
import { rupiah } from '../../types';
import PageHeader from '../../components/PageHeader';

const EMPTY: Partial<Plan> = {
  code: '', name: '', description: '', price: 0, billing_period: 'monthly',
  max_numbers: 1, max_ai_replies_monthly: 1000, is_active: true, is_popular: false, sort_order: 0,
};

export default function AdminPlans() {
  const { data: plans, isLoading } = useAdminPlans();
  const savePlan = useSavePlan();
  const deletePlan = useDeletePlan();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<Plan>>(EMPTY);

  const openNew = () => { setForm(EMPTY); setOpen(true); };
  const openEdit = (p: Plan) => { setForm(p); setOpen(true); };
  const num = (k: keyof Plan) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });
  const str = (k: keyof Plan) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => { await savePlan.mutateAsync(form); setOpen(false); };
  const remove = async (p: Plan) => {
    if (await swalConfirm(`Hapus plan "${p.name}"?`)) await deletePlan.mutateAsync(p.id);
  };

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <PageHeader title="Plans"
        action={<Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>Tambah Plan</Button>} />

      <Card>
        <CardContent sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Nama</TableCell>
                <TableCell>Code</TableCell>
                <TableCell align="right">Harga</TableCell>
                <TableCell align="center">Nomor</TableCell>
                <TableCell align="center">Balasan AI/bln</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="right">Aksi</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {plans?.map(p => (
                <TableRow key={p.id} hover>
                  <TableCell>{p.name} {p.is_popular && <Chip label="Populer" size="small" color="primary" sx={{ ml: 0.5 }} />}</TableCell>
                  <TableCell><code>{p.code}</code></TableCell>
                  <TableCell align="right">{rupiah(p.price)}</TableCell>
                  <TableCell align="center">{p.max_numbers}</TableCell>
                  <TableCell align="center">{p.max_ai_replies_monthly || '∞'}</TableCell>
                  <TableCell align="center">
                    <Chip label={p.is_active ? 'Aktif' : 'Nonaktif'} size="small" color={p.is_active ? 'success' : 'default'} />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(p)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => remove(p)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{form.id ? 'Edit Plan' : 'Plan Baru'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Code (unik, mis. starter)" value={form.code ?? ''} onChange={str('code')} disabled={!!form.id} size="small" />
            <TextField label="Nama" value={form.name ?? ''} onChange={str('name')} size="small" />
            <TextField label="Deskripsi" value={form.description ?? ''} onChange={str('description')} size="small" multiline rows={2} />
            <Stack direction="row" spacing={2}>
              <TextField label="Harga (Rp)" type="number" value={form.price ?? 0} onChange={num('price')} size="small" fullWidth />
              <TextField label="Periode" value={form.billing_period ?? 'monthly'} onChange={str('billing_period')} size="small" fullWidth />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Max Nomor" type="number" value={form.max_numbers ?? 1} onChange={num('max_numbers')} size="small" fullWidth />
              <TextField label="Balasan AI/bln (0=∞)" type="number" value={form.max_ai_replies_monthly ?? 0} onChange={num('max_ai_replies_monthly')} size="small" fullWidth />
            </Stack>
            <TextField label="Urutan tampil" type="number" value={form.sort_order ?? 0} onChange={num('sort_order')} size="small" />
            <Stack direction="row" spacing={2}>
              <FormControlLabel control={<Switch checked={!!form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />} label="Aktif" />
              <FormControlLabel control={<Switch checked={!!form.is_popular} onChange={e => setForm({ ...form, is_popular: e.target.checked })} />} label="Populer" />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Batal</Button>
          <Button variant="contained" onClick={save} disabled={savePlan.isPending}>Simpan</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
