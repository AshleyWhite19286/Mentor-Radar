import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'导师雷达 · 找到你的科研起点',description:'面向低年级学生的交大导师与研究方向导航。用近期论文理解研究，找到自己的入门路径。'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="zh-CN"><body>{children}</body></html>;}
