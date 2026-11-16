'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
export function PanelAutoRefresh(){const router=useRouter();useEffect(()=>{const refresh=()=>{if(document.visibilityState!=='hidden')router.refresh();};const timer=window.setInterval(refresh,30000);document.addEventListener('visibilitychange',refresh);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};},[router]);return null;}
