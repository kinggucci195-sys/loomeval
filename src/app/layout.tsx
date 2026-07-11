import React from 'react';
import './globals.css';

export const metadata = {
  title: 'LoomEval Dashboard',
  description: 'Incident Response & Release safety infrastructure for browser agents.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
