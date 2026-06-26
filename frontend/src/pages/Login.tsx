import { useEffect, useState } from 'react';
import { Box, Card, CardContent, TextField, Button, Typography, Alert, CircularProgress, Link } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
// logo removed — text-only branding

declare global { interface Window { turnstile: any; __TURNSTILE_SITE_KEY__?: string } }

function responseStatus(error: unknown) {
  if (typeof error === 'object' && error && 'response' in error) {
    return (error as { response?: { status?: number; headers?: Record<string, string> } }).response;
  }
  return undefined;
}

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [turnstileToken, setTurnstile] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((v) => Math.max(0, v - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleLogin = async () => {
    if (loading || cooldown > 0) return;
    const cleanUsername = username.trim();
    const e: Record<string, string> = {};
    if (!cleanUsername) e.username = 'Wajib diisi';
    if (!password) e.password = 'Wajib diisi';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/login', { username: cleanUsername, password, turnstile: turnstileToken });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      navigate(res.data.user?.is_super_admin ? '/admin' : '/app');
    } catch (e) {
      const response = responseStatus(e);
      if (response?.status === 429) {
        const retryAfter = Number(response.headers?.['retry-after'] || 60);
        setCooldown(Number.isFinite(retryAfter) ? Math.min(Math.max(retryAfter, 30), 300) : 60);
        setError('Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.');
      } else if (!response || (response.status ?? 0) >= 500) {
        setError('Server belum siap. Coba lagi sebentar lagi.');
      } else {
        setError('Login belum berhasil. Periksa kembali data yang kamu masukkan.');
      }
      setLoading(false);
      if (window.turnstile) window.turnstile.reset();
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <Box sx={{ textAlign: 'center', pt: 3, pb: 0, px: { xs: 3, sm: 4 } }}>
          <Typography sx={{ fontWeight: 900, fontSize: 28, color: "primary.main", textAlign: "center", mb: 0.5 }}>Balesin</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", mb: 2 }}>Masuk ke dashboard</Typography>
        </Box>
        <CardContent sx={{ pt: 1, px: { xs: 3, sm: 4 }, pb: { xs: 3, sm: 4 }, '&:last-child': { pb: { xs: 3, sm: 4 } } }}>
            {error && <Alert severity={cooldown > 0 ? 'warning' : 'error'} sx={{ mb: 2 }}>{error}</Alert>}
          <TextField fullWidth label="Username" value={username} disabled={loading || cooldown > 0}
            autoComplete="username"
            onChange={e => { setUsername(e.target.value); if (errors.username) setErrors(p => ({...p, username: ''})); }}
            error={!!errors.username} helperText={errors.username}
            sx={{ mb: 1.5 }} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <TextField fullWidth label="Password" type="password" value={password} disabled={loading || cooldown > 0}
            autoComplete="current-password"
            onChange={e => { setPassword(e.target.value); if (errors.password) setErrors(p => ({...p, password: ''})); }}
            error={!!errors.password} helperText={errors.password}
            sx={{ mb: 2 }} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <Button fullWidth variant="contained" onClick={handleLogin} disabled={loading || cooldown > 0}
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}
            sx={{ py: 1.5, fontWeight: 700 }}>
            {loading ? 'Masuk…' : cooldown > 0 ? `Coba lagi ${cooldown}d` : 'Masuk'}
          </Button>
          <Typography variant="body2" sx={{ mt: 2, textAlign: 'center' }}>
            <Link href="/lupa-password" underline="hover">Lupa password?</Link>
          </Typography>
          <Typography variant="body2" sx={{ textAlign: 'center' }}>
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
