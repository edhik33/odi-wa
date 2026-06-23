import { Box, Container, Typography, Button, Grid, Card, CardContent, Stack, Avatar, Chip, type ButtonProps } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import heroLogo from '../assets/Logo-chatloop-gradients.png';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { usePublicPlans } from '../hooks';
import { rupiah } from '../types';

const PAINS = [
  'Chat menumpuk pas kamu lagi sibuk, calon pembeli keburu kabur ke toko sebelah.',
  'Pertanyaan yang sama datang berulang sepanjang hari, dan tanganmu pegal mengetik jawaban serupa.',
  'Lewat tengah malam toko sudah tutup, tapi calon pembeli masih bertanya dan tak ada yang membalas.',
  'Kamu ingin libur sebentar, tapi takut kehilangan orderan.',
];

const FEATURES = [
  {
    icon: <ChatBubbleOutlineIcon />,
    title: 'Balasan yang terasa seperti manusia',
    body: 'ChatLoop menjawab dengan gaya bahasa yang kamu pilih, hangat dan tidak kaku. Pelanggan merasa sungguh didengar, bukan sedang bicara dengan robot.',
  },
  {
    icon: <LightbulbOutlinedIcon />,
    title: 'Paham detail bisnismu',
    body: 'Ajari sekali lewat knowledge base. ChatLoop mengingat harga, stok, dan aturan tokomu, lalu menjawab persis sesuai yang kamu mau.',
  },
  {
    icon: <SupportAgentOutlinedIcon />,
    title: 'Tahu kapan harus memanggilmu',
    body: 'Saat ada yang ragu atau butuh sentuhan pribadi, ChatLoop berhenti sejenak dan menyerahkan obrolan ke kamu. Tidak ada pelanggan yang dibiarkan terlantar.',
  },
  {
    icon: <DevicesOutlinedIcon />,
    title: 'Banyak nomor, satu layar',
    body: 'Kelola semua nomor CS dari satu dashboard. Pantau semuanya dengan tenang, tanpa harus pindah aplikasi.',
  },
];

const STEPS = [
  { n: '1', title: 'Hubungkan WhatsApp', body: 'Pindai satu QR, nomormu langsung tersambung.' },
  { n: '2', title: 'Ajari sebentar', body: 'Ceritakan soal produk dan pilih gaya bicaranya.' },
  { n: '3', title: 'Biarkan ChatLoop bekerja', body: 'Pelanggan dibalas otomatis, siang dan malam, tanpa kamu pegang HP.' },
];

function CtaButton({ size = 'large', loggedIn, onClick }: { size?: ButtonProps['size']; loggedIn: boolean; onClick: () => void }) {
  return (
    <Button variant="contained" size={size} onClick={onClick} sx={{ fontWeight: 700, px: 4, py: 1.4 }}>
      {loggedIn ? 'Buka Dashboard' : 'Coba Gratis 7 Hari'}
    </Button>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const { data: plans } = usePublicPlans();
  const loggedIn = !!localStorage.getItem('token');
  const goToCta = () => navigate(loggedIn ? '/app' : '/daftar');

  return (
    <Box sx={{ bgcolor: 'background.default' }}>
      {/* Navbar */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 20, bgcolor: 'rgba(244,251,246,0.85)', backdropFilter: 'blur(8px)', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="lg" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <img src={heroLogo} alt="ChatLoop" style={{ height: 'clamp(28px, 6vw, 38px)' }} />
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => navigate('/login')}>Masuk</Button>
            <Button variant="contained" onClick={() => navigate(loggedIn ? '/app' : '/daftar')}>
              {loggedIn ? 'Dashboard' : 'Coba Gratis'}
            </Button>
          </Stack>
        </Container>
      </Box>

      {/* Hero */}
      <Box sx={{ background: 'linear-gradient(160deg, #F4FBF6 0%, #d8f0e1 100%)' }}>
        <Container maxWidth="md" sx={{ textAlign: 'center', py: { xs: 8, md: 12 } }}>
          <Chip label="Asisten WhatsApp bertenaga AI" color="primary" variant="outlined" sx={{ mb: 3 }} />
          <Typography variant="h2" sx={{ fontWeight: 900, fontSize: { xs: 34, md: 52 }, lineHeight: 1.1, mb: 2 }}>
            Pelanggan chat kapan saja, bisnismu tetap menjawab
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 400, color: 'text.secondary', mb: 4, maxWidth: 620, mx: 'auto' }}>
            ChatLoop membalas setiap pesan masuk dengan ramah dan cepat, hafal produkmu, dan tahu kapan harus memanggilmu. Kamu istirahat, jualan tetap jalan.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'center', alignItems: 'center' }}>
            <CtaButton loggedIn={loggedIn} onClick={goToCta} />
            <Button variant="text" size="large" onClick={() => navigate('/login')}>Sudah punya akun</Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Tanpa kartu kredit. Siap pakai dalam beberapa menit.
          </Typography>
        </Container>
      </Box>

      {/* Empati / masalah */}
      <Container maxWidth="md" sx={{ py: { xs: 7, md: 10 } }}>
        <Typography variant="h4" sx={{ fontWeight: 800, textAlign: 'center', mb: 1 }}>
          Kenal banget sama situasi ini?
        </Typography>
        <Typography color="text.secondary" sx={{ textAlign: 'center', mb: 5 }}>
          Kalau iya, kamu tidak sendirian. Dan ada cara yang lebih ringan.
        </Typography>
        <Grid container spacing={2}>
          {PAINS.map((p, i) => (
            <Grid size={{ xs: 12, sm: 6 }} key={i}>
              <Card sx={{ height: '100%', bgcolor: '#fff' }}>
                <CardContent>
                  <Typography sx={{ fontSize: 17, lineHeight: 1.5 }}>{p}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
        <Typography variant="h5" sx={{ fontWeight: 800, textAlign: 'center', mt: 5, color: 'primary.dark' }}>
          Mulai sekarang, semua itu biar ChatLoop yang urus.
        </Typography>
      </Container>

      {/* Fitur */}
      <Box sx={{ bgcolor: '#fff', borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
          <Typography variant="h4" sx={{ fontWeight: 800, textAlign: 'center', mb: 1 }}>
            Kenapa pemilik bisnis jatuh cinta sama ChatLoop
          </Typography>
          <Typography color="text.secondary" sx={{ textAlign: 'center', mb: 5 }}>
            Bukan sekadar balas otomatis. ChatLoop hadir layaknya CS terbaikmu.
          </Typography>
          <Grid container spacing={3}>
            {FEATURES.map((f, i) => (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={i}>
                <Stack spacing={1.5} sx={{ height: '100%' }}>
                  <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.dark', width: 52, height: 52 }}>{f.icon}</Avatar>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>{f.title}</Typography>
                  <Typography color="text.secondary" sx={{ lineHeight: 1.55 }}>{f.body}</Typography>
                </Stack>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* Cara kerja */}
      <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
        <Typography variant="h4" sx={{ fontWeight: 800, textAlign: 'center', mb: 5 }}>
          Siap pakai dalam hitungan menit
        </Typography>
        <Grid container spacing={3}>
          {STEPS.map((s) => (
            <Grid size={{ xs: 12, md: 4 }} key={s.n}>
              <Card sx={{ height: '100%', textAlign: 'center', bgcolor: '#fff' }}>
                <CardContent sx={{ py: 4 }}>
                  <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48, mx: 'auto', mb: 2, fontSize: 22, fontWeight: 800 }}>{s.n}</Avatar>
                  <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>{s.title}</Typography>
                  <Typography color="text.secondary">{s.body}</Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      {/* Harga */}
      <Box sx={{ bgcolor: '#fff', borderTop: '1px solid', borderColor: 'divider' }}>
        <Container maxWidth="lg" sx={{ py: { xs: 7, md: 10 } }}>
          <Typography variant="h4" sx={{ fontWeight: 800, textAlign: 'center', mb: 1 }}>
            Harga yang masuk akal untuk bisnis yang lagi tumbuh
          </Typography>
          <Typography color="text.secondary" sx={{ textAlign: 'center', mb: 5 }}>
            Pilih paket sesuai kebutuhan. Bisa naik kelas kapan saja.
          </Typography>
          <Grid container spacing={3} sx={{ justifyContent: 'center' }}>
            {plans?.map((p) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={p.id}>
                <Card sx={{ height: '100%', position: 'relative', border: p.is_popular ? '2px solid' : '1px solid', borderColor: p.is_popular ? 'primary.main' : 'divider' }}>
                  <CardContent sx={{ p: 3 }}>
                    {p.is_popular && <Chip label="Paling diminati" color="primary" size="small" sx={{ mb: 1 }} />}
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{p.name}</Typography>
                    <Typography color="text.secondary" sx={{ minHeight: 40, fontSize: 14 }}>{p.description}</Typography>
                    <Box sx={{ my: 2 }}>
                      <Typography component="span" variant="h4" sx={{ fontWeight: 900 }}>{rupiah(p.price)}</Typography>
                      <Typography component="span" color="text.secondary"> /{p.billing_period === 'yearly' ? 'tahun' : 'bulan'}</Typography>
                    </Box>
                    <Stack spacing={1} sx={{ mb: 3 }}>
                      <Bullet text={`${p.max_numbers} nomor WhatsApp`} />
                      <Bullet text={p.max_ai_replies_monthly ? `${p.max_ai_replies_monthly.toLocaleString('id-ID')} balasan AI tiap bulan` : 'Balasan AI tanpa batas'} />
                      <Bullet text="Knowledge base sendiri" />
                      <Bullet text="Alih ke CS manusia otomatis" />
                    </Stack>
                    <Button fullWidth variant={p.is_popular ? 'contained' : 'outlined'} onClick={() => navigate('/daftar')} sx={{ fontWeight: 700 }}>
                      Mulai Sekarang
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* CTA penutup */}
      <Box sx={{ background: 'linear-gradient(160deg, #1F8A50 0%, #005d2c 100%)', color: '#fff' }}>
        <Container maxWidth="md" sx={{ textAlign: 'center', py: { xs: 8, md: 11 } }}>
          <Typography variant="h3" sx={{ fontWeight: 900, fontSize: { xs: 28, md: 42 }, mb: 2 }}>
            Pelanggan berikutnya bisa datang malam ini juga
          </Typography>
          <Typography sx={{ opacity: 0.9, mb: 4, fontSize: 18 }}>
            Coba ChatLoop gratis tujuh hari. Tanpa kartu kredit, tanpa ribet. Rasakan sendiri bedanya saat tak ada lagi chat yang terlewat.
          </Typography>
          <Button variant="contained" size="large" onClick={() => navigate(loggedIn ? '/app' : '/daftar')}
            sx={{ bgcolor: '#fff', color: 'primary.dark', fontWeight: 800, px: 5, py: 1.5, '&:hover': { bgcolor: '#f0f0f0' } }}>
            {loggedIn ? 'Buka Dashboard' : 'Mulai Gratis Sekarang'}
          </Button>
        </Container>
      </Box>

      {/* Footer */}
      <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          ChatLoop. Asisten WhatsApp yang bikin bisnismu selalu hadir untuk pelanggan.
        </Typography>
        <Typography variant="caption" color="text.secondary">© {new Date().getFullYear()} ChatLoop</Typography>
      </Container>
    </Box>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <CheckCircleIcon sx={{ color: 'primary.main', fontSize: 20, mt: '1px' }} />
      <Typography variant="body2">{text}</Typography>
    </Stack>
  );
}
