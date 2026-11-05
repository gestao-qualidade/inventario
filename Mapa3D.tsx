'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Barra, Carregando, Kpi, Modal, fmt, useCarregar } from './ui';
import ProdutoFoto from './ProdutoFoto';

type Dados = { versao: string; posicoes: [string, string, number][]; contagem: Record<string, number>; cobertura: { total: number; inventariadas: number; percentual: number } };
const NOMES = ['Não inventariada', 'Em andamento', 'Concluída sem divergência', 'Concluída com divergência', 'Pendente de tratativa'];
const CORES = ['#94a3b8', '#3b82f6', '#22c55e', '#facc15', '#ef4444'];
const DX = 1.15, DY = 1.0, DZ = 4.2;

type P = { id: string; gal: string; st: number; rua: string; col: number; alt: number };
const parse = (id: string, gal: string, st: number): P => {
  const s = id.toUpperCase().split('.'); const n = (x?: string) => (x && /^\d+$/.test(x) ? parseInt(x, 10) : 0);
  return { id, gal, st, rua: s[0] || '?', col: n(s[1]), alt: n(s[2]) };
};

export default function Mapa3D() {
  const { dados, erro, carregando, recarregar } = useCarregar<Dados>(() => rpc('mapa.dados'), []);
  const [modo, setModo] = useState<'areas' | 'posicoes'>('posicoes');
  const [oculto, setOculto] = useState<Set<number>>(new Set());
  const [galpao, setGalpao] = useState(''); const [busca, setBusca] = useState('');
  const [dica, setDica] = useState<{ x: number; y: number; t: string } | null>(null);
  const [detalhe, setDetalhe] = useState<any>(null); const [errD, setErrD] = useState('');
  const host = useRef<HTMLDivElement>(null);

  const itens = useMemo(() => (dados?.posicoes || []).map(([id, g, st]) => parse(id, g, st)), [dados]);
  const galpoes = useMemo(() => [...new Set(itens.map(i => i.gal))].sort(), [itens]);
  const filtrados = useMemo(() => itens.filter(i => (!galpao || i.gal === galpao) && !oculto.has(i.st)), [itens, galpao, oculto]);

  const abrir = async (id: string) => {
    setErrD(''); setDetalhe({ posicao: id, carregando: true });
    try { setDetalhe(await rpc('mapa.posicao', { posicao: id })); } catch (e) { setErrD(msgErro(e)); setDetalhe({ posicao: id }); }
  };

  useEffect(() => {
    const el = host.current; if (!el || !itens.length) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#0b1229');
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    const r = new THREE.WebGLRenderer({ antialias: true }); r.setPixelRatio(Math.min(devicePixelRatio, 2)); el.appendChild(r.domElement);
    const ctl = new OrbitControls(cam, r.domElement); ctl.enableDamping = true;
    scene.add(new THREE.AmbientLight('#ffffff', 0.85)); const luz = new THREE.DirectionalLight('#ffffff', 1.1); luz.position.set(60, 120, 80); scene.add(luz);

    const ruas = [...new Set(filtrados.map(i => i.rua))].sort();
    const zRua = new Map(ruas.map((x, i) => [x, i * DZ]));
    const maxX = Math.max(1, ...filtrados.map(i => i.col)) * DX, maxZ = Math.max(1, ruas.length) * DZ, maxY = Math.max(1, ...filtrados.map(i => i.alt)) * DY;
    const grupo = new THREE.Group(); scene.add(grupo);
    let malha: THREE.InstancedMesh | null = null; const mapaIdx: P[] = [];

    // chão
    const chao = new THREE.Mesh(new THREE.PlaneGeometry(maxX + 20, maxZ + 20), new THREE.MeshBasicMaterial({ color: '#111c3d' }));
    chao.rotation.x = -Math.PI / 2; chao.position.set(maxX / 2, -0.6, maxZ / 2 - DZ / 2); grupo.add(chao);

    const rotulo = (txt: string) => {
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const g = cv.getContext('2d')!;
      g.fillStyle = '#e2e8f0'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 64, 34);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false })); sp.scale.set(5, 2.5, 1); return sp;
    };
    ruas.forEach(x => { const s = rotulo(x); s.position.set(-4, 1.5, zRua.get(x)!); grupo.add(s); });

    if (modo === 'posicoes') {
      const geo = new THREE.BoxGeometry(DX * 0.82, DY * 0.78, DZ * 0.55);
      malha = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), filtrados.length);
      const m4 = new THREE.Matrix4();
      filtrados.forEach((p, i) => { m4.setPosition(p.col * DX, p.alt * DY, zRua.get(p.rua)!); malha!.setMatrixAt(i, m4); malha!.setColorAt(i, new THREE.Color(CORES[p.st])); mapaIdx.push(p); });
      malha.instanceMatrix.needsUpdate = true; if (malha.instanceColor) malha.instanceColor.needsUpdate = true; grupo.add(malha);
    } else {
      // por áreas: cada rua (prateleira) é uma barra colorida pelo pior estado/andamento
      const agg = new Map<string, number[]>(); filtrados.forEach(p => { const a = agg.get(p.rua) || [0, 0, 0, 0, 0]; a[p.st]++; agg.set(p.rua, a); });
      const lista = ruas.filter(x => agg.has(x)); malha = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), lista.length);
      const m4 = new THREE.Matrix4(); const q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3();
      lista.forEach((x, i) => {
        const a = agg.get(x)!; const tot = a.reduce((s, v) => s + v, 0); const colMax = Math.max(...filtrados.filter(p => p.rua === x).map(p => p.col), 1); const altMax = Math.max(...filtrados.filter(p => p.rua === x).map(p => p.alt), 1);
        const st = a[4] > 0 ? 4 : a[0] === tot ? 0 : (a[2] + a[3]) === tot ? (a[3] ? 3 : 2) : 1;
        sc.set(colMax * DX, altMax * DY, DZ * 0.6); pos.set(colMax * DX / 2, altMax * DY / 2, zRua.get(x)!); m4.compose(pos, q, sc); malha!.setMatrixAt(i, m4); malha!.setColorAt(i, new THREE.Color(CORES[st]));
        mapaIdx.push({ id: x, gal: '', st, rua: x, col: tot, alt: 0 });
      });
      grupo.add(malha);
    }

    const dist = Math.max(maxX, maxZ * 0.9, 20); cam.position.set(maxX * 0.5, dist * 0.55, maxZ + dist * 0.55); ctl.target.set(maxX / 2, maxY / 3, maxZ / 2); ctl.update();

    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let ultimo = 0;
    const pick = (ev: PointerEvent) => {
      const b = r.domElement.getBoundingClientRect(); mouse.set(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1); ray.setFromCamera(mouse, cam);
      const h = malha ? ray.intersectObject(malha)[0] : undefined; return h && h.instanceId !== undefined ? mapaIdx[h.instanceId] : null;
    };
    const mover = (ev: PointerEvent) => {
      const t = performance.now(); if (t - ultimo < 70) return; ultimo = t; const p = pick(ev);
      setDica(p ? { x: ev.clientX, y: ev.clientY, t: modo === 'posicoes' ? `${p.id} · ${NOMES[p.st]}` : `Rua ${p.id} · ${p.col} posições · ${NOMES[p.st]}` } : null);
    };
    let downX = 0, downY = 0;
    const down = (ev: PointerEvent) => { downX = ev.clientX; downY = ev.clientY; };
    const click = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 4) return; const p = pick(ev); if (p && modo === 'posicoes') abrir(p.id); else if (p) setBusca(''); };
    r.domElement.addEventListener('pointermove', mover); r.domElement.addEventListener('pointerdown', down); r.domElement.addEventListener('pointerup', click);

    const ajustar = () => { const w = el.clientWidth, h = el.clientHeight; r.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    ajustar(); const ro = new ResizeObserver(ajustar); ro.observe(el);
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); ctl.update(); r.render(scene, cam); }; loop();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); ctl.dispose();
      r.domElement.removeEventListener('pointermove', mover); r.domElement.removeEventListener('pointerdown', down); r.domElement.removeEventListener('pointerup', click);
      scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) { (mat as THREE.SpriteMaterial).map?.dispose(); mat.dispose(); } });
      r.dispose(); el.removeChild(r.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, modo, itens.length]);

  const achar = () => { const p = itens.find(i => i.id.toUpperCase() === busca.trim().toUpperCase()); if (p) abrir(p.id); else setErrD('Posição não encontrada na base ativa.'); };
  if (carregando) return <Carregando texto="Montando o mapa a partir da planilha…" />;
  if (erro || !dados) return <Alerta>{erro}</Alerta>;
  const c = dados.contagem;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi rotulo="Cobertura (posições únicas)" valor={`${dados.cobertura.percentual}%`} sub={`${fmt(dados.cobertura.inventariadas)} de ${fmt(dados.cobertura.total)}`} />
        {[0, 1, 2, 3, 4].map(i => <Kpi key={i} rotulo={NOMES[i]} valor={fmt([c.nao, c.andamento, c.ok, c.divergente, c.pendente][i])} cor="" />)}
      </div>
      <Barra pct={dados.cobertura.percentual} />
      <div className="card !p-3">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">{(['posicoes', 'areas'] as const).map(m => <button key={m} onClick={() => setModo(m)} className={`rounded-lg px-4 py-1.5 text-sm font-bold ${modo === m ? 'bg-white text-blue-700 shadow' : 'text-slate-500'}`}>{m === 'posicoes' ? 'Por posições' : 'Por áreas'}</button>)}</div>
          <select className="input !w-auto" value={galpao} onChange={e => setGalpao(e.target.value)}><option value="">Todos os galpões</option>{galpoes.map(g => <option key={g}>{g}</option>)}</select>
          <div className="flex gap-2"><input className="input !w-44" placeholder="Achar posição (I.25.2)" value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && achar()} /><button className="btn btn-secondary" onClick={achar}>Ir</button></div>
          <button className="btn btn-secondary ml-auto" onClick={recarregar}>Atualizar</button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">{NOMES.map((n, i) => <button key={i} onClick={() => setOculto(s => { const x = new Set(s); x.has(i) ? x.delete(i) : x.add(i); return x; })}
          className={`chip ${oculto.has(i) ? 'chip-off opacity-50 line-through' : 'chip-off'}`}><span className="h-3 w-3 rounded-sm" style={{ background: CORES[i] }} />{n}</button>)}<span className="self-center text-xs text-slate-500">Clique na legenda para ocultar/mostrar · arraste para girar · role para aproximar · clique em uma posição para ver os dados</span></div>
        <div ref={host} className="h-[62vh] min-h-[420px] w-full overflow-hidden rounded-2xl ring-1 ring-slate-300" />
      </div>
      {dica && <div className="pointer-events-none fixed z-50 rounded-lg bg-slate-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg" style={{ left: dica.x + 14, top: dica.y + 14 }}>{dica.t}</div>}
      {errD && !detalhe && <Alerta>{errD}</Alerta>}
      {detalhe && <Modal titulo={`Posição ${detalhe.posicao}`} onClose={() => { setDetalhe(null); setErrD(''); }} largo>
        {detalhe.carregando ? <Carregando /> : errD ? <Alerta>{errD}</Alerta> : (
          <div className="space-y-5">
            <div><h3 className="mb-2 text-sm font-bold">Itens da posição</h3>
              {!detalhe.itens?.length ? <p className="text-sm text-slate-500">Esta posição ainda não faz parte de nenhum inventário.</p> :
                <div className="overflow-x-auto"><table className="w-full"><thead><tr><th className="th">Produto</th><th className="th">Inventário</th><th className="th text-right">Saldo</th><th className="th">Lote / validade</th><th className="th">Status</th></tr></thead><tbody>
                  {detalhe.itens.map((i: any, n: number) => <tr key={n}><td className="td"><div className="flex items-center gap-2"><ProdutoFoto sku={i.sku} className="h-10 w-10" /><div><div className="font-semibold">{i.sku}</div><div className="text-xs text-slate-500">{i.descricao}</div></div></div></td>
                    <td className="td text-xs">{i.inventario}</td><td className="td text-right font-semibold">{fmt(i.saldo)}</td>
                    <td className="td text-xs">{i.lotes?.length ? i.lotes.map((l: any) => `${l.lote || 's/ lote'}${l.validade ? ' · ' + l.validade : ''}`).join(' | ') : '—'}</td><td className="td text-xs">{i.status}</td></tr>)}</tbody></table></div>}</div>
            {detalhe.divergencias?.length > 0 && <div><h3 className="mb-2 text-sm font-bold">Divergências</h3><ul className="space-y-1 text-sm">{detalhe.divergencias.map((d: any, n: number) => <li key={n} className="rounded-lg bg-red-50 px-3 py-2"><b>{d.sku}</b> — {d.tipo}: sistema {fmt(d.saldo)}, final {fmt(d.final)} · {d.status}<div className="text-xs text-slate-600">{d.acao}</div></li>)}</ul></div>}
            <div><h3 className="mb-2 text-sm font-bold">Histórico de contagens</h3>
              {!detalhe.historico?.length ? <p className="text-sm text-slate-500">Nenhuma contagem registrada.</p> :
                <table className="w-full"><thead><tr><th className="th">Quando</th><th className="th">Operador</th><th className="th">SKU</th><th className="th text-right">Qtd</th><th className="th">Etapa</th></tr></thead><tbody>
                  {detalhe.historico.map((h: any, n: number) => <tr key={n}><td className="td text-xs">{h.data} {h.hora}</td><td className="td">{h.operador}</td><td className="td">{h.sku}</td><td className="td text-right">{fmt(h.qtd)}</td><td className="td">{h.etapa}ª</td></tr>)}</tbody></table>}</div>
          </div>)}
      </Modal>}
    </div>
  );
}
