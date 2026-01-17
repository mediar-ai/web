import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VM Dashboard",
  description: "Manage Hyper-V VMs with VNC access",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
