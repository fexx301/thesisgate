import type { Metadata } from "next";
import "./hallmark.css";

export const metadata: Metadata = {
  title: "ThesisGate | Stress-test the trade behind the headline",
  description: "A source-bounded research brief and deterministic stock-linked token scenario calculator.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
