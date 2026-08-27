import type {Metadata} from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "0G-Delphi",
  description: "Pasar prediksi biner di 0G Chain",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="id">
      <body className="min-h-dvh bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
