import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Necro-Oracle",
  description: "A multi-agent code-resurrection system.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
