import { createTheme } from '@mui/material/styles';

// ────────────────────────────────────────────────────────────
// Design tokens (sumber kebenaran ada di index.css :root)
// Theme MUI ini mirror nilai yang sama supaya konsisten.
// ────────────────────────────────────────────────────────────

const TOKENS = {
  color: {
    primary:        '#1F8A50',
    primaryLight:   '#5DBA7D',
    primaryDark:    '#005D2C',
    secondary:      '#4A6357',
    secondaryLight: '#7A9387',
    secondaryDark:  '#1D3B30',
    success:        '#1F8A50',
    warning:        '#9A6700',
    error:          '#BA1A1A',
    bg:             '#F4FBF6',
    bgAlt:          '#F5F7F5',
    surface:        '#FFFFFF',
    surfaceMuted:   '#EDF2ED',
    text:           '#1A1C19',
    textSecondary:  '#5A635C',
    border:         '#DCE5DC',
    borderLight:    '#ECF2EC',
  },
  font: {
    sans:   'Inter, Roboto, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    xs:     '12px',
    sm:     '14px',
    md:     '16px',
    lg:     '18px',
    xl:     '22px',
    xxl:    '28px',
    xxxl:   '38px',
    hero:   '52px',
  },
  weight: {
    normal:    400,
    medium:   500,
    semibold: 600,
    bold:     700,
    extrabold: 800,
    black:    900,
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
  },
  space: {
    s1: 4, s2: 8, s3: 12, s4: 16, s5: 20,
    s6: 24, s8: 32, s10: 40, s12: 48,
  },
} as const;

const theme = createTheme({
  palette: {
    mode: 'light',
    primary:    { main: TOKENS.color.primary,    light: TOKENS.color.primaryLight,  dark: TOKENS.color.primaryDark,    contrastText: '#ffffff' },
    secondary:  { main: TOKENS.color.secondary,  light: TOKENS.color.secondaryLight, dark: TOKENS.color.secondaryDark, contrastText: '#ffffff' },
    success:    { main: TOKENS.color.success },
    warning:    { main: TOKENS.color.warning },
    error:      { main: TOKENS.color.error },
    background: { default: TOKENS.color.bg,  paper: TOKENS.color.surface },
    text:       { primary: TOKENS.color.text, secondary: TOKENS.color.textSecondary },
    divider:    TOKENS.color.border,
  },
  shape: { borderRadius: TOKENS.radius.sm },
  typography: {
    fontFamily: TOKENS.font.sans,
    h1: { fontWeight: TOKENS.weight.black,    fontSize: TOKENS.font.hero,  lineHeight: 1.1,  letterSpacing: 0 },
    h2: { fontWeight: TOKENS.weight.black,    fontSize: TOKENS.font.xxxl,  lineHeight: 1.15, letterSpacing: 0 },
    h3: { fontWeight: TOKENS.weight.extrabold, fontSize: TOKENS.font.xxl, lineHeight: 1.2,  letterSpacing: 0 },
    h4: { fontWeight: TOKENS.weight.extrabold, fontSize: TOKENS.font.xl,  lineHeight: 1.25, letterSpacing: 0 },
    h5: { fontWeight: TOKENS.weight.bold,      fontSize: TOKENS.font.lg,   lineHeight: 1.3,  letterSpacing: 0 },
    h6: { fontWeight: TOKENS.weight.bold,      fontSize: TOKENS.font.md,   lineHeight: 1.35, letterSpacing: 0 },
    subtitle1: { fontWeight: TOKENS.weight.semibold, fontSize: TOKENS.font.sm, lineHeight: 1.45 },
    subtitle2: { fontWeight: TOKENS.weight.semibold, fontSize: TOKENS.font.xs, lineHeight: 1.35 },
    body1: { fontSize: TOKENS.font.sm, lineHeight: 1.45 },
    body2: { fontSize: TOKENS.font.xs, lineHeight: 1.45 },
    caption: { fontSize: TOKENS.font.xs, lineHeight: 1.35 },
    button: { textTransform: 'none', fontWeight: TOKENS.weight.semibold, letterSpacing: 0 },
  },
  components: {
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiButtonBase: {
      styleOverrides: { root: { cursor: 'pointer' } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'small' },
      styleOverrides: {
        root:       { borderRadius: TOKENS.radius.sm, paddingBlock: TOKENS.space.s1, paddingInline: TOKENS.space.s3, minHeight: 32 },
        sizeLarge:  { minHeight: 40, paddingBlock: TOKENS.space.s2, paddingInline: TOKENS.space.s4 },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderRadius: TOKENS.radius.sm, border: `1px solid ${TOKENS.color.border}` } },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: TOKENS.space.s3, '&:last-child': { paddingBottom: TOKENS.space.s3 } } },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { padding: `${TOKENS.space.s3} ${TOKENS.space.s4}`, fontSize: TOKENS.font.md, fontWeight: TOKENS.weight.bold } },
    },
    MuiDialogContent: {
      styleOverrides: { root: { padding: `${TOKENS.space.s3} ${TOKENS.space.s4}` } },
    },
    MuiDialogActions: {
      styleOverrides: { root: { padding: `${TOKENS.space.s2} ${TOKENS.space.s4} ${TOKENS.space.s3}` } },
    },
    MuiAlert: {
      styleOverrides: {
        root:    { borderRadius: TOKENS.radius.sm, padding: `${TOKENS.space.s2} ${TOKENS.space.s3}` },
        message: { padding: '2px 0' },
      },
    },
    MuiIconButton: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { borderRadius: TOKENS.radius.sm, padding: TOKENS.space.s1 } },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: TOKENS.radius.sm } },
    },
    MuiInputBase: {
      styleOverrides: { root: { fontSize: TOKENS.font.sm } },
    },
    MuiInputLabel: {
      styleOverrides: { root: { fontSize: TOKENS.font.sm } },
    },
    MuiChip: {
      styleOverrides: {
        root:      { borderRadius: TOKENS.radius.sm, fontWeight: TOKENS.weight.semibold, height: 24 },
        sizeSmall: { height: 22, fontSize: TOKENS.font.xs },
      },
    },
    MuiAvatar: {
      styleOverrides: { root: { fontWeight: TOKENS.weight.bold } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { cursor: 'pointer' } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { cursor: 'pointer', minHeight: 40, paddingTop: TOKENS.space.s1, paddingBottom: TOKENS.space.s1 } },
    },
    MuiListItemText: {
      styleOverrides: { primary: { fontSize: TOKENS.font.sm }, secondary: { fontSize: TOKENS.font.xs } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: TOKENS.color.borderLight, padding: `${TOKENS.space.s2} ${TOKENS.space.s3}`, fontSize: TOKENS.font.xs },
        head: { fontWeight: TOKENS.weight.bold, color: TOKENS.color.textSecondary },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { borderRadius: TOKENS.radius.sm } },
    },
  },
});

export default theme;
