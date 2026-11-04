import type { ReactNode } from "react";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";

export const metadata = {
  title: "Leash",
  description: "A leash for AI agents' money, enforced onchain on NEAR.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
