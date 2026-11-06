import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Ledgerly | Business money, made clear",
  description: "A clear view of your recorded business money and what needs attention.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
