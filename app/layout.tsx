import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'AgniDrishti — Thermal Intelligence', description: 'AI-powered thermal anomaly intelligence platform' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
