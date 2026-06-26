import { Box, Typography, Button, Paper } from '@mui/material';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Paper variant="outlined" sx={{
      p: { xs: 3, md: 5 },
      textAlign: 'center',
      borderStyle: 'dashed',
      borderColor: 'divider',
      borderRadius: 2,
      bgcolor: 'action.hover',
    }}>
      <Box sx={{ mb: 1.5, color: 'text.disabled' }}>
        {icon}
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 400, mx: 'auto' }}>
        {description}
      </Typography>
      {actionLabel && onAction && (
        <Button variant="contained" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Paper>
  );
}
