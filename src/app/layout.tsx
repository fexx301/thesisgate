import type { Metadata } from "next";
import "./hallmark.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://thesisgate.duckdns.org";
const TITLE = "ThesisGate | Stress-test the trade behind the headline";
const DESCRIPTION = "Stock tokens trade 24/7. Describe your trade idea on a Bitget stock token: ThesisGate checks whether the news is new, how far the token has moved since the US close, and what your trade needs after fees, using live Bitget data. Research only; it never places orders.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { type: "website", url: "/", siteName: "ThesisGate", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
