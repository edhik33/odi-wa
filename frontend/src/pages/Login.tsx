import { useState } from 'react';
import { Box, Card, CardContent, TextField, Button, Typography, Alert, Backdrop, CircularProgress } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async () => {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/login', { username, password });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      navigate('/');
    } catch {
      setError('Username atau password salah');
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" sx={{ fontWeight: 800, mb: 3, textAlign: 'center' }}>
            🤖 WA AI Assistant
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <TextField fullWidth label="Username" value={username} disabled={loading}
            onChange={e => setUsername(e.target.value)}
            sx={{ mb: 2 }} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <TextField fullWidth label="Password" type="password" value={password} disabled={loading}
            onChange={e => setPassword(e.target.value)}
            sx={{ mb: 3 }} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
          <Button fullWidth variant="contained" onClick={handleLogin} disabled={loading}
            startIcon={loading ? <CircularProgress size={18} color="inherit" /> : null}
            sx={{ py: 1.5, fontWeight: 700 }}>
            {loading ? 'Masuk…' : 'Login'}
          </Button>
        </CardContent>
      </Card>
      <Backdrop open={loading} sx={{ color: '#fff', zIndex: (t) => t.zIndex.drawer + 1 }}>
        <CircularProgress color="inherit" />
      </Backdrop>
    </Box>
  );
}
