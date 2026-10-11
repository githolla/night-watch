import type { Metadata } from "next";import { Geist } from "next/font/google";import "./globals.css";
import { heroStyle } from "@/lib/hero";
import { AppChrome } from "@/components/AppChrome";
const geist=Geist({subsets:["latin"],variable:"--font-geist",display:"swap"});
export const metadata:Metadata={title:"Nine-67 Night Watch",description:"Nine-67 signal-led outbound desk"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en" className={geist.variable}><body style={heroStyle}><AppChrome />{children}</body></html>}
