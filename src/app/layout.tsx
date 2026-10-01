import type { Metadata } from "next";import "./globals.css";
import { heroStyle } from "@/lib/hero";
import { AppChrome } from "@/components/AppChrome";
export const metadata:Metadata={title:"Nine-67 Night Watch",description:"Nine-67 signal-led outbound desk"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body style={heroStyle}><AppChrome />{children}</body></html>}
