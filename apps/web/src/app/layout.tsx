import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Float',
  description: 'ENS-named, non-custodial treasury wallet for agent-paid businesses',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="wrap">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
