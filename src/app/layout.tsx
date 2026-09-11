import type { Metadata } from "next";import "./globals.css";
import { heroStyle } from "@/lib/hero";
export const metadata:Metadata={title:"Night Watch",description:"Nine-67 signal-led outbound desk"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body style={heroStyle}>{children}</body></html>}
