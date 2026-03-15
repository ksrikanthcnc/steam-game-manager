import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Game Collection Manager",
  description: "Manage your game collection with tags and filters",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen overflow-hidden">{children}</body>
    </html>
  );
}
