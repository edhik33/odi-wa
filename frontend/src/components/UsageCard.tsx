import { Typography, Chip, Stack } from '@mui/material';
import { useUsage } from '../hooks';

const STATUS_COLOR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  active: 'success', trial: 'warning', suspended: 'error', expired: 'default',
};

export default function UsageCard() {
  const { data } = useUsage();
  if (!data) return null;
  const t = data.tenant;
  const planName = t.plan?.name || 'Trial';

  let periodText = '';
  if (t.status === 'trial' && t.trial_ends_at) {
    periodText = `Trial sampai ${new Date(t.trial_ends_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } else if (t.status === 'active') {
    periodText = 'Paket aktif';
  } else if (t.status === 'suspended') {
    periodText = 'Paket ditangguhkan';
  } else if (t.status === 'expired') {
    periodText = 'Paket sudah berakhir';
  }

  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{planName}</Typography>
      <Chip label={t.status} size="small" color={STATUS_COLOR[t.status] ?? 'default'} />
      {periodText && (
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>{periodText}</Typography>
      )}
    </Stack>
  );
}
