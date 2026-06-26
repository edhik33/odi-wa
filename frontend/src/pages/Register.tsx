import { useState } from 'react';
import { Box, Card, CardContent, TextField, Button, Typography, Alert, Link } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
// logo removed — text-only branding

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    return response?.data?.error || fallback;
  }
  return fallback;
}

function normalizePhone(v: string): string {
  return v.replace(/[^0-9+]/g, '').replace(/^0+/, '62').replace(/^\+/, '').slice(0, 15);
}

declare global { interface Window { turnstile: any; __TURNSTILE_SITE_KEY__?: string } }

export default function Register() {
  const [form, setForm] = useState({ name: '', business_name: '', phone: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstile] = useState('');
  const navigate = useNavigate();

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    if (errors[k]) setErrors(p => ({ ...p, [k]: '' }));
  };

  const handlePhoneBlur = () => {
    setForm(f => ({ ...f, phone: normalizePhone(f.phone) }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Wajib diisi';
    if (!form.business_name.trim()) e.business_name = 'Wajib diisi';
    if (!form.phone.trim()) {
      e.phone = 'Wajib diisi';
    } else if (form.phone.replace(/\D/g, '').length < 8) {
      e.phone = 'Nomor terlalu pendek';
    }
    if (!form.email.trim()) e.email = 'Wajib diisi';
    if (!form.password) e.password = 'Wajib diisi (min. 8 karakter)';
    else if (form.password.length < 8) e.password = 'Minimal 8 karakter';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async () => {
    if (loading) return;
    if (!validate()) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/register', { ...form, turnstile: turnstileToken });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      navigate('/app');
    } catch (e) {
      setError(errorMessage(e, 'Gagal mendaftar'));
      setLoading(false);
      // Reset Turnstile
      if (window.turnstile) window.turnstile.reset();
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <Box sx={{ textAlign: 'center', pt: 3, pb: 0, px: { xs: 3, sm: 4 } }}>
          <Typography sx={{ fontWeight: 900, fontSize: 28, color: "primary.main", textAlign: "center", mb: 1 }}>Bales</Typography>
        </Box>
        <CardContent sx={{ pt: 1, px: { xs: 3, sm: 4 }, pb: { xs: 3, sm: 4 }, '&:last-child': { pb: { xs: 3, sm: 4 } } }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField fullWidth label="Nama Bisnis" value={form.business_name} onChange={set('business_name')} disabled={loading}
            error={!!errors.business_name} helperText={errors.business_name} sx={{ mb: 1.5 }} />
          <TextField fullWidth label="Nama Kamu" value={form.name} onChange={set('name')} disabled={loading}
            error={!!errors.name} helperText={errors.name} sx={{ mb: 1.5 }} />
          <TextField fullWidth label="Nomor WhatsApp" value={form.phone} onChange={set('phone')} onBlur={handlePhoneBlur} disabled={loading}
            error={!!errors.phone} helperText={errors.phone || 'Contoh: 08123456789'}
            placeholder="08123456789" sx={{ mb: 1.5 }} />
          <TextField fullWidth label="Email" type="email" value={form.email} onChange={set('email')} disabled={loading}
            error={!!errors.email} helperText={errors.email} sx={{ mb: 1.5 }} />
          <TextField fullWidth label="Password" type="password" value={form.password} onChange={set('password')} disabled={loading}
            error={!!errors.password} helperText={errors.password}
            sx={{ mb: 2 }} onKeyDown={e => e.key === 'Enter' && handleRegister()} />
          <Button fullWidth variant="contained" onClick={handleRegister} disabled={loading} sx={{ py: 1.5, fontWeight: 700 }}>
            {loading ? 'Mendaftar…' : 'Daftar Sekarang'}
          </Button>
          <Typography variant="body2" sx={{ mt: 2, textAlign: 'center' }}>
            Sudah punya akun? <Link href="/login" underline="hover">Login</Link>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
