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
  /* The dragon mark doubles as the tab icon and the share card, so the first
     use in commerce covers the places the link actually shows up rather than
     just the page body. Small variant for both: 256px is more than a favicon
     needs, and the share card is displayed small everywhere that renders it. */
  icons: { icon: "/brand/carver-dragon-mark-small.png" },
  openGraph: {
    title: "Dragon Rematch — Round 4",
    description:
      "Six metres of dragon, in the room you're standing in. Dodge the fire, shoot back.",
    images: [{ url: "/brand/carver-dragon-mark-small.png", width: 256, height: 256 }],
  },
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
