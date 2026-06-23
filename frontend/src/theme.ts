import { createTheme } from '@mui/material/styles';

// Tema app dibuat rapat untuk dashboard operasional: sedikit chrome, radius kecil, dan padding konsisten.
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1F8A50', light: '#5dba7d', dark: '#005d2c', contrastText: '#ffffff' },
    secondary: { main: '#4A6357', light: '#7a9387', dark: '#1d3b30', contrastText: '#ffffff' },
    success: { main: '#1F8A50' },
    warning: { main: '#9a6700' },
    error: { main: '#ba1a1a' },
    background: { default: '#F4FBF6', paper: '#FFFFFF' },
    text: { primary: '#1A1C19', secondary: '#5a635c' },
    divider: '#DCE5DC',
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: 'Inter, Roboto, system-ui, "Helvetica Neue", Arial, sans-serif',
    h4: { fontWeight: 800, fontSize: '1.35rem', lineHeight: 1.25, letterSpacing: 0 },
    h5: { fontWeight: 800, fontSize: '1.13rem', lineHeight: 1.3, letterSpacing: 0 },
    h6: { fontWeight: 750, fontSize: '0.98rem', lineHeight: 1.35, letterSpacing: 0 },
    subtitle1: { fontWeight: 650, lineHeight: 1.45 },
    subtitle2: { fontWeight: 750, fontSize: '0.84rem', lineHeight: 1.35 },
    body1: { fontSize: '0.94rem', lineHeight: 1.45 },
    body2: { fontSize: '0.86rem', lineHeight: 1.45 },
    caption: { fontSize: '0.75rem', lineHeight: 1.35 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButtonBase: {
      styleOverrides: { root: { cursor: 'pointer' } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'small' },
      styleOverrides: {
        root: { borderRadius: 5, paddingBlock: 5, paddingInline: 12, minHeight: 32 },
        sizeLarge: { minHeight: 38, paddingBlock: 7, paddingInline: 16 },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderRadius: 6, border: '1px solid #DCE5DC' } },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 14, '&:last-child': { paddingBottom: 14 } } },
    },
    MuiDialogTitle: { styleOverrides: { root: { padding: '14px 18px', fontSize: '1rem', fontWeight: 750 } } },
    MuiDialogContent: { styleOverrides: { root: { padding: '14px 18px' } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '10px 18px 14px' } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 6, padding: '8px 12px' }, message: { padding: '2px 0' } } },
    MuiIconButton: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { borderRadius: 5, padding: 6 } },
    },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 6 } } },
    MuiInputBase: { styleOverrides: { root: { fontSize: '0.9rem' } } },
    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.9rem' } } },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 5, fontWeight: 650, height: 24 },
        sizeSmall: { height: 22, fontSize: '0.72rem' },
      },
    },
    MuiAvatar: { styleOverrides: { root: { fontWeight: 700 } } },
    MuiMenuItem: { styleOverrides: { root: { cursor: 'pointer' } } },
    MuiListItemButton: { styleOverrides: { root: { cursor: 'pointer', minHeight: 42, paddingTop: 6, paddingBottom: 6 } } },
    MuiListItemText: { styleOverrides: { primary: { fontSize: '0.9rem' }, secondary: { fontSize: '0.75rem' } } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: '#ECF2EC', padding: '8px 10px', fontSize: '0.84rem' },
        head: { fontWeight: 700, color: '#5a635c' },
      },
    },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 6 } } },
  },
});

export default theme;
