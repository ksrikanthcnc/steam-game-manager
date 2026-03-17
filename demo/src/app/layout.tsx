import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steam Game Manager — Demo",
  description: "Read-only demo of the Steam Game Manager",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen overflow-hidden">{children}</body>
    </html>
  );
}
