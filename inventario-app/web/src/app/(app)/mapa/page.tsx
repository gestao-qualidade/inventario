'use client';
import dynamic from 'next/dynamic';
import { Carregando, Titulo } from '@/components/ui';

const Mapa3D = dynamic(() => import('@/components/Mapa3D'), { ssr: false, loading: () => <Carregando texto="Carregando o mapa 3D…" /> });

export default function Mapa() { return <div><Titulo>Mapa 3D do armazém</Titulo><Mapa3D /></div>; }
