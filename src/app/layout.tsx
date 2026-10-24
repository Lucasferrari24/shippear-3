import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/shell/app-shell";
import { StoreProvider } from "@/lib/store";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LaVirshion · Control de calidad por visión",
  description: "Control de calidad por visión con IA para la línea de envasado de Virginia: tapa, nivel y trazabilidad.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark bg-background">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <StoreProvider>
          <TooltipProvider delayDuration={200}>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
          <Toaster
            theme="dark"
            position="top-center"
            toastOptions={{
              style: {
                background: "rgb(44 44 46 / 0.9)",
                backdropFilter: "blur(20px)",
                border: "1px solid rgb(255 255 255 / 0.08)",
                borderRadius: "18px",
                color: "#F5F5F7",
              },
            }}
          />
        </StoreProvider>
      </body>
    </html>
  );
}
