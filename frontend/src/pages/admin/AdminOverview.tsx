import {
  Box, Card, CardContent, Typography, Grid, CircularProgress,
  Select, MenuItem, FormControl, InputLabel, Alert, Stack, Chip,
} from '@mui/material';
import { useAdminStats, useAdminAIModel, useSetAdminAIModel } from '../../hooks';
import { rupiah } from '../../types';
import { swalToast } from '../../services/swal';
import PageHeader from '../../components/PageHeader';

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h4" sx={{ fontWeight: 800, color }}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
      </CardContent>
    </Card>
  );
}

function AIModelCard() {
  const { data, isLoading } = useAdminAIModel();
  const setModel = useSetAdminAIModel();

  const change = async (preset: string) => {
    try {
      await setModel.mutateAsync(preset);
      swalToast('Model AI diganti', 'success');
    } catch {
      swalToast('Gagal mengganti model', 'error');
    }
  };

  if (isLoading || !data) return null;
  const activePreset = data.presets.find(p => p.key === data.active);

  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Model AI (berlaku untuk semua tenant)</Typography>
          {activePreset && <Chip size="small" label={activePreset.model} variant="outlined" />}
        </Stack>
        <FormControl size="small" fullWidth sx={{ maxWidth: 360 }}>
          <InputLabel>Model aktif</InputLabel>
          <Select label="Model aktif" value={data.active} disabled={setModel.isPending}
            onChange={e => change(e.target.value)}>
            {data.presets.map(p => (
              <MenuItem key={p.key} value={p.key} disabled={!p.available && p.key !== data.active}>
                {p.label}{!p.available ? ' · API key belum diisi' : ''}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {activePreset && !activePreset.available && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            API key untuk model ini belum diisi di server, jadi AI otomatis pakai DeepSeek sebagai cadangan. Isi env-nya (mis. <code>OPENROUTER_API_KEY</code>) lalu pilih ulang.
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
          Model selain DeepSeek lewat OpenRouter (satu API key buka banyak model). Ganti berlaku langsung tanpa restart.
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function AdminOverview() {
  const { data, isLoading } = useAdminStats();

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>;

  return (
    <Box>
      <PageHeader title="Ringkasan Platform" subtitle="Pantauan singkat tenant, langganan, dan pemakaian AI." />
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Total Tenant" value={data?.total_tenants ?? 0} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Aktif (berbayar)" value={data?.active_tenants ?? 0} color="#2e7d32" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Trial" value={data?.trial_tenants ?? 0} color="#ed6c02" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label={`Balasan AI (${data?.period ?? ''})`} value={data?.ai_replies_month ?? 0} /></Grid>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Total Pendapatan (lunas)" value={rupiah(data?.revenue_total ?? 0)} color="#1565c0" /></Grid>
        <Grid size={{ xs: 12 }}><AIModelCard /></Grid>
      </Grid>
    </Box>
  );
}
