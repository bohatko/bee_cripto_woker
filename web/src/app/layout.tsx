import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import {
  I18N_PENDING_CLASS,
  LOCALE_COOKIE_NAME,
  normalizeLocale,
} from "@/lib/i18n/types";

export const metadata: Metadata = {
  title: "Bee Crypto Worker | Market-Neutral Alpha Trading Platform",
  description: "Automated multi-pair long-short algorithmic trading basket for Binance, OKX, and Bybit with zero market beta.",
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

// Runs before the page paints. It mirrors the localStorage locale into a cookie
// (so the server can render the right language next time) and, when the server
// rendered a different language than the visitor prefers, hides the page until
// React applies the stored locale. This prevents a flash of the wrong language.
const localeInitScript = `(function(){try{
var K=${JSON.stringify(LOCALE_COOKIE_NAME)};
var P=${JSON.stringify(I18N_PENDING_CLASS)};
var valid=function(v){return v==='en'||v==='ru';};
var stored=null,cookie=null;
try{stored=localStorage.getItem(K);}catch(e){}
var parts=document.cookie?document.cookie.split(';'):[];
for(var i=0;i<parts.length;i++){
var p=parts[i].trim();
if(p.indexOf(K+'=')===0){try{cookie=decodeURIComponent(p.slice(K.length+1));}catch(e){cookie=p.slice(K.length+1);}break;}
}
var storedLocale=valid(stored)?stored:null;
var cookieLocale=valid(cookie)?cookie:null;
var target=storedLocale||cookieLocale||'en';
if(storedLocale&&storedLocale!==cookieLocale){
document.cookie=K+'='+storedLocale+';path=/;max-age=31536000;samesite=lax';
}
if(target!==document.documentElement.getAttribute('lang')){
document.documentElement.classList.add(P);
setTimeout(function(){document.documentElement.classList.remove(P);},3000);
}
document.documentElement.setAttribute('lang',target);
}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialLocale = normalizeLocale(
    cookieStore.get(LOCALE_COOKIE_NAME)?.value
  );

  return (
    <html lang={initialLocale} suppressHydrationWarning>
      <body className="bg-dark-950 text-slate-100 antialiased min-h-screen" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: localeInitScript }} />
        <LanguageProvider initialLocale={initialLocale}>
          {children}
          <Toaster />
        </LanguageProvider>
      </body>
    </html>
  );
}
