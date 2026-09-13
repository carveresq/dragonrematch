import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "Dragon Rematch — Round 4",
  description:
    "The hidden dragon boss from carveresq.com, back for round 4 — in AR, life-size, wherever you're standing.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={plexMono.variable}>
      <body style={{ fontFamily: "var(--font-mono), 'IBM Plex Mono', monospace" }}>
        {children}
      </body>
    </html>
  );
}
