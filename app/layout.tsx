import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConnectChat",
  description: "Private messaging, voice and video communication.",
  applicationName: "ConnectChat",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}