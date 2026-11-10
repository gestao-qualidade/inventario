'use client';
import Contagem from '@/components/Contagem';
export default function Pagina({ params }: { params: { tipo: string } }) { const t = params.tipo.toUpperCase(); return <Contagem key={t} tipo={t} />; }
