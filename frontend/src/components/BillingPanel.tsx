import { useState } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Grid, Chip, Stack, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, Select, MenuItem, FormControl,
  InputLabel, Table, TableBody, TableCell, TableHead, TableRow, CircularProgress,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { usePublicPlans, useUsage, useBillingChannels, useInvoices, useCheckout } from '../hooks';
import type { Plan } from '../types';
import { rupiah } from '../types';
import PageHeader from './PageHeader';

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  active: 'success', trial: 'warning', suspended: 'error', expired: 'default', paid: 'success', pending: 'warning',
};

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error || fallback;
  }
  return fallback;
}

export default function BillingPanel() {
  const { data: plans } = usePublicPlans();
  const { data: usage } = useUsage();
  const { data: channels, isError: channelsError } = useBillingChannels();
  const { data: invoices } = useInvoices();
  const checkout = useCheckout();

  const [selected, setSelected] = useState<Plan | null>(null);
  const [method, setMethod] = useState('');
  const [error, setError] = useState('');

  const pay = async () => {
    if (!selected || !method) return;
    setError('');
    try {
      const res = await checkout.mutateAsync({ plan_id: selected.id, method });
      window.location.href = res.checkout_url; // arahkan ke halaman bayar Tripay
    } catch (e) {
      setError(errorMessage(e, 'Gagal membuat pembayaran'));
    }
  };

  return (
    <Box>
      <PageHeader title="Langganan" />

      {usage && (
        <Alert severity={usage.tenant.status === 'active' ? 'success' : 'info'} sx={{ mb: 2 }}>
          Paket saat ini: <b>{usage.tenant.plan?.name || 'Trial'}</b> · status <b>{usage.tenant.status}</b>
          {usage.tenant.status === 'trial' && usage.tenant.trial_ends_at &&
            ` · trial berakhir ${new Date(usage.tenant.trial_ends_at).toLocaleDateString('id-ID')}`}
        </Alert>
      )}

      {channelsError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Pembayaran online belum aktif. Hubungi admin untuk upgrade manual sementara.
        </Alert>
      )}

      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        {plans?.map(p => {
          const current = usage?.tenant.plan_id === p.id;
          return (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={p.id}>
              <Card sx={{ height: '100%', border: p.is_popular ? '2px solid #25D366' : undefined }}>
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                    <Typography variant="h6">{p.name}</Typography>
                    {p.is_popular && <Chip label="Populer" size="small" color="primary" />}
                  </Stack>
                  <Typography variant="h6">{rupiah(p.price)}</Typography>
                  <Typography variant="caption" color="text.secondary">/{p.billing_period === 'yearly' ? 'tahun' : 'bulan'}</Typography>
                  <Stack spacing={0.5} sx={{ my: 1.5 }}>
                    <Typography variant="body2"><CheckIcon sx={{ fontSize: 16, verticalAlign: 'middle', color: '#25D366' }} /> {p.max_numbers} nomor WhatsApp</Typography>
                    <Typography variant="body2"><CheckIcon sx={{ fontSize: 16, verticalAlign: 'middle', color: '#25D366' }} /> {p.max_ai_replies_monthly ? `${p.max_ai_replies_monthly.toLocaleString('id-ID')} balasan AI/bln` : 'Balasan AI tanpa batas'}</Typography>
                  </Stack>
                  <Button fullWidth variant={current ? 'outlined' : 'contained'} disabled={current || channelsError}
                    onClick={() => { setSelected(p); setMethod(''); setError(''); }}>
                    {current ? 'Paket aktif' : 'Pilih paket ini'}
                  </Button>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {invoices && invoices.length > 0 && (
        <Card>
          <CardContent sx={{ overflowX: 'auto' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Riwayat Tagihan</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tanggal</TableCell>
                  <TableCell>Ref</TableCell>
                  <TableCell align="right">Jumlah</TableCell>
                  <TableCell align="center">Status</TableCell>
                  <TableCell align="right"></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.map(inv => (
                  <TableRow key={inv.id} hover>
                    <TableCell>{new Date(inv.created_at).toLocaleDateString('id-ID')}</TableCell>
                    <TableCell><code>{inv.merchant_ref}</code></TableCell>
                    <TableCell align="right">{rupiah(inv.amount)}</TableCell>
                    <TableCell align="center"><Chip label={inv.status} size="small" color={STATUS_COLOR[inv.status] ?? 'default'} /></TableCell>
                    <TableCell align="right">
                      {inv.status === 'pending' && inv.checkout_url &&
                        <Button size="small" href={inv.checkout_url}>Bayar</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth maxWidth="xs">
        <DialogTitle>Bayar paket {selected?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Total: <b>{rupiah(selected?.price || 0)}</b>
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <FormControl fullWidth size="small">
            <InputLabel>Metode Pembayaran</InputLabel>
            <Select value={method} label="Metode Pembayaran" onChange={e => setMethod(e.target.value)}>
              {channels?.map(ch => <MenuItem key={ch.code} value={ch.code}>{ch.name}</MenuItem>)}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>Batal</Button>
          <Button variant="contained" onClick={pay} disabled={!method || checkout.isPending}
            startIcon={checkout.isPending ? <CircularProgress size={16} /> : null}>
            Bayar Sekarang
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
