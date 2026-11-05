'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Barra, Carregando, Kpi, Modal, fmt, useCarregar } from './ui';
import ProdutoFoto from './ProdutoFoto';

type Dados = { versao: string; posicoes: [string, string, number][]; contagem: Record<string, number>; cobertura: { total: number; inventariadas: number; percentual: number } };
const NOMES = ['Não inventariada', 'Em andamento', 'Concluída sem divergência', 'Concluída com divergência', 'Pendente de tratativa'];
// 0 = papelão natural (ainda não inventariada); os demais são cores sólidas de status
const CORES = ['#b5834a', '#2f6bff', '#22a35a', '#f5c400', '#e63946'];
const PAPELAO = ['#b5834a', '#a8763f', '#c2925c', '#9c6f3a'];

// medidas da estante (mesmo desenho do armazém de referência)
const COL_SPACING = 1.35, LEVEL_HEIGHT = 1.9, RACK_DEPTH = 1.15, AISLE_WIDTH = 3.4, CORRIDOR_GAP = 2.6;
const BASE_Y = 0.15, BEAM = 0.08, POST = 0.12, BLOCK_GAP = 14, PALLET_H = 0.16, COLUMN_TAG_STEP = 5;

type P = { id: string; gal: string; st: number; rua: string; col: number; alt: number };
type Pick = { tipo: 'pos'; p: P } | { tipo: 'area'; rua: string; gal: string; total: number; st: number };
const parse = (id: string, gal: string, st: number): P => {
  const s = id.toUpperCase().split('.'); const n = (x?: string) => (x && /^\d+$/.test(x) ? parseInt(x, 10) : 0);
  return { id, gal, st, rua: s[0] || '?', col: Math.max(1, n(s[1])), alt: Math.max(1, n(s[2])) };
};
const cmpNat = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });

/** Primeira rua só com lado direito; depois pares esquerda/direita em volta de cada corredor. */
function corredores(ruas: string[]) {
  const c: { left: string | null; right: string | null }[] = [];
  if (!ruas.length) return c;
  c.push({ left: null, right: ruas[0] });
  for (let i = 1; i < ruas.length; i += 2) c.push({ left: ruas[i], right: ruas[i + 1] ?? null });
  return c;
}

export default function Mapa3D() {
  const { dados, erro, carregando, recarregar } = useCarregar<Dados>(() => rpc('mapa.dados'), []);
  const [modo, setModo] = useState<'areas' | 'posicoes'>('posicoes');
  const [oculto, setOculto] = useState<Set<number>>(new Set());
  const [galpao, setGalpao] = useState(''); const [busca, setBusca] = useState('');
  const [dica, setDica] = useState<{ x: number; y: number; t: string } | null>(null);
  const [detalhe, setDetalhe] = useState<any>(null); const [errD, setErrD] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset?: () => void; topo?: () => void; ir?: (id: string) => void }>({});

  const itens = useMemo(() => (dados?.posicoes || []).map(([id, g, st]) => parse(id, g, st)), [dados]);
  const galpoes = useMemo(() => [...new Set(itens.map(i => i.gal))].sort(cmpNat), [itens]);
  const estrutura = useMemo(() => itens.filter(i => !galpao || i.gal === galpao), [itens, galpao]);
  const filtrados = useMemo(() => estrutura.filter(i => !oculto.has(i.st)), [estrutura, oculto]);

  const abrir = async (id: string) => {
    setErrD(''); setDetalhe({ posicao: id, carregando: true });
    try { setDetalhe(await rpc('mapa.posicao', { posicao: id })); } catch (e) { setErrD(msgErro(e)); setDetalhe({ posicao: id }); }
  };

  useEffect(() => {
    const el = host.current; if (!el || !estrutura.length) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf2f1ec);
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); el.appendChild(r.domElement);
    const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sol = new THREE.DirectionalLight(0xffffff, 0.9); scene.add(sol);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd6d6, 0.6));

    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a4fc4, roughness: 0.35, metalness: 0.55 });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xf07d1a, roughness: 0.35, metalness: 0.5 });
    const aisleMat = new THREE.MeshStandardMaterial({ color: 0xc9be87, roughness: 0.85, transparent: true, opacity: 0.28 });
    const dummy = new THREE.Object3D();

    // rótulos (sprites com textura em cache)
    const cache = new Map<string, THREE.CanvasTexture>();
    const rotulo = (txt: string, x: number, y: number, z: number, o: { big?: boolean; cor?: string; w?: number } = {}) => {
      const k = txt + '|' + (o.big ? 1 : 0) + '|' + (o.cor || ''); let tex = cache.get(k);
      if (!tex) {
        const cv = document.createElement('canvas'); cv.width = o.big ? 512 : 96; cv.height = o.big ? 144 : 48; const g = cv.getContext('2d')!;
        g.fillStyle = o.cor || '#8a6512'; g.font = `bold ${o.big ? 96 : 30}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, cv.width / 2, cv.height / 2);
        tex = new THREE.CanvasTexture(cv); cache.set(k, tex);
      }
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true })); sp.position.set(x, y, z);
      const w = o.w || (o.big ? 3.6 : 0.85); sp.scale.set(w, w * (o.big ? 144 / 512 : 0.5), 1); scene.add(sp);
    };

    // um bloco de estantes por galpão, lado a lado
    const porGal = new Map<string, P[]>(); estrutura.forEach(p => { const a = porGal.get(p.gal) || []; a.push(p); porGal.set(p.gal, a); });
    const blocos = [...porGal.keys()].sort(cmpNat).map(g => ({ g, ps: porGal.get(g)! }));
    type Ent = { p: P; x: number; z: number; y: number };
    const ents: Ent[] = []; const areas: { rua: string; gal: string; x: number; z: number; w: number; h: number; d: number; total: number; st: number }[] = [];
    let originX = 0, totalW = 0, totalD = 0, maxTop = 0;
    const vis = new Set(filtrados.map(f => f.id + '|' + f.gal));

    let nPost = 0, nBeam = 0; const layouts = blocos.map(b => {
      const ruas = [...new Set(b.ps.map(p => p.rua))].sort(cmpNat);
      const maxCol: Record<string, number> = {}, maxNiv: Record<string, number> = {};
      b.ps.forEach(p => { maxCol[p.rua] = Math.max(maxCol[p.rua] || 0, p.col); maxNiv[p.rua] = Math.max(maxNiv[p.rua] || 0, p.alt); });
      const cs = corredores(ruas); const span = AISLE_WIDTH + RACK_DEPTH * 2 + CORRIDOR_GAP;
      const ruaX: Record<string, number> = {}, face: Record<string, number> = {};
      cs.forEach((c, i) => { const cx = originX + i * span; if (c.left) { ruaX[c.left] = cx - AISLE_WIDTH / 2 - RACK_DEPTH / 2; face[c.left] = 1; } if (c.right) { ruaX[c.right] = cx + AISLE_WIDTH / 2 + RACK_DEPTH / 2; face[c.right] = -1; } });
      const w = cs.length * span, d = Math.max(1, ...ruas.map(x => maxCol[x])) * COL_SPACING;
      ruas.forEach(x => { nPost += (maxCol[x] + 1) * 2; nBeam += (maxNiv[x] + 1) * 2; });
      const L = { ...b, ruas, maxCol, maxNiv, cs, span, ruaX, face, w, d, ox: originX };
      originX += w + BLOCK_GAP; totalW = originX - BLOCK_GAP; totalD = Math.max(totalD, d); return L;
    });

    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(POST, 1, POST), postMat, Math.max(1, nPost));
    const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(BEAM, BEAM, 1), beamMat, Math.max(1, nBeam));
    let pi = 0, bi = 0;
    layouts.forEach(L => {
      if (blocos.length > 1) rotulo(L.g, L.ox + L.w / 2 - L.span / 2, 1.2, -4.5, { big: true, cor: '#1c2b3a', w: 7 });
      L.cs.forEach((_, ci) => {
        const cx = L.ox + ci * L.span; const a = new THREE.Mesh(new THREE.PlaneGeometry(AISLE_WIDTH * 0.94, L.d), aisleMat);
        a.rotation.x = -Math.PI / 2; a.position.set(cx, 0.01, L.d / 2); scene.add(a);
      });
      L.ruas.forEach(rua => {
        const x = L.ruaX[rua]; if (x === undefined) return;
        const mc = L.maxCol[rua], mn = L.maxNiv[rua], topo = mn * LEVEL_HEIGHT + BASE_Y + 0.3, prof = mc * COL_SPACING; maxTop = Math.max(maxTop, topo);
        for (let k = 0; k <= mc; k++) [-RACK_DEPTH / 2, RACK_DEPTH / 2].forEach(o => { dummy.position.set(x + o, topo / 2, k * COL_SPACING); dummy.scale.set(1, topo, 1); dummy.updateMatrix(); posts.setMatrixAt(pi++, dummy.matrix); });
        for (let k = 0; k <= mn; k++) [-RACK_DEPTH / 2, RACK_DEPTH / 2].forEach(o => { dummy.position.set(x + o, BASE_Y + k * LEVEL_HEIGHT, prof / 2); dummy.scale.set(1, 1, prof + 0.3); dummy.updateMatrix(); beams.setMatrixAt(bi++, dummy.matrix); });
        rotulo(rua, x, topo + 0.7, -1.4, { big: true, cor: '#1c2b3a', w: 5.5 });
        for (let c = 1; c <= mc; c += COLUMN_TAG_STEP) rotulo(String(c).padStart(2, '0'), x, 0.28, (c - 1) * COL_SPACING + 0.05, { cor: '#8a6512' });
        const doRua = L.ps.filter(p => p.rua === rua);
        const mostradas = doRua.filter(p => vis.has(p.id + '|' + p.gal));
        const cont = [0, 0, 0, 0, 0]; mostradas.forEach(p => cont[p.st]++);
        const tot = mostradas.length;
        const st = cont[4] > 0 ? 4 : tot && cont[0] === tot ? 0 : tot && cont[2] + cont[3] === tot ? (cont[3] ? 3 : 2) : 1;
        if (tot) areas.push({ rua, gal: L.g, x, z: prof / 2, w: RACK_DEPTH * 0.96, h: mn * LEVEL_HEIGHT, d: prof, total: tot, st });
        mostradas.forEach(p => ents.push({ p, x, z: (p.col - 0.5) * COL_SPACING, y: BASE_Y + (p.alt - 1) * LEVEL_HEIGHT }));
      });
    });
    [posts, beams].forEach(m => { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; scene.add(m); });
    // pisos sob cada bloco e geral
    const piso = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 40, totalD + 40), new THREE.MeshBasicMaterial({ color: 0xe8e6dd }));
    piso.rotation.x = -Math.PI / 2; piso.position.set(totalW / 2 - 4, 0, totalD / 2); scene.add(piso);

    // paletes + caixas (uma pilha por posição). Posições sem item não são desenhadas.
    let pickMeshes: THREE.InstancedMesh[] = []; let boxDono: number[] = []; let pallet: THREE.InstancedMesh | null = null, boxes: THREE.InstancedMesh | null = null, areaMesh: THREE.InstancedMesh | null = null;
    const corTmp = new THREE.Color();
    if (modo === 'posicoes') {
      pallet = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.92 }), Math.max(1, ents.length));
      boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 }), Math.max(1, ents.length * 2));
      const palX = RACK_DEPTH * 0.8, palZ = COL_SPACING * 0.86, sy = LEVEL_HEIGHT * 0.38; let bi2 = 0;
      ents.forEach((e, i) => {
        dummy.position.set(e.x, e.y + PALLET_H / 2 + 0.02, e.z); dummy.scale.set(palX, PALLET_H, palZ); dummy.updateMatrix(); pallet!.setMatrixAt(i, dummy.matrix); pallet!.setColorAt(i, corTmp.set('#e3c99a'));
        [-1, 1].forEach((s, k) => {
          dummy.position.set(e.x + s * RACK_DEPTH * 0.19, e.y + PALLET_H + 0.03 + sy / 2, e.z); dummy.scale.set(RACK_DEPTH * 0.34, sy, COL_SPACING * 0.62); dummy.updateMatrix();
          boxes!.setMatrixAt(bi2, dummy.matrix); boxes!.setColorAt(bi2, corTmp.set(e.p.st === 0 ? PAPELAO[(i + k) % 4] : CORES[e.p.st])); boxDono[bi2] = i; bi2++;
        });
      });
      [pallet, boxes].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.frustumCulled = false; scene.add(m); });
      pickMeshes = [pallet, boxes];
    } else {
      areaMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5, transparent: true, opacity: 0.82 }), Math.max(1, areas.length));
      areas.forEach((a, i) => { dummy.position.set(a.x, BASE_Y + a.h / 2 + 0.2, a.z); dummy.scale.set(a.w, a.h, a.d); dummy.updateMatrix(); areaMesh!.setMatrixAt(i, dummy.matrix); areaMesh!.setColorAt(i, corTmp.set(a.st === 0 ? '#c2925c' : CORES[a.st])); });
      areaMesh.instanceMatrix.needsUpdate = true; if (areaMesh.instanceColor) areaMesh.instanceColor.needsUpdate = true; areaMesh.frustumCulled = false; scene.add(areaMesh); pickMeshes = [areaMesh];
    }

    // câmera
    const ctl = new OrbitControls(cam, r.domElement); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI / 2 - 0.04; ctl.minDistance = 4;
    const cx = totalW / 2 - 4, cz = totalD / 2, grande = Math.max(totalW, totalD, 20);
    ctl.maxDistance = grande * 3; scene.fog = new THREE.Fog(0xf2f1ec, grande * 2.2, grande * 6);
    sol.position.set(cx + 25, 35 + maxTop, cz + 18);
    const reset = () => { cam.position.set(cx, Math.max(maxTop * 1.3, grande * 0.36), totalD + grande * 0.78); ctl.target.set(cx, maxTop * 0.3, cz); ctl.update(); };
    const topo = () => { cam.position.set(cx, grande * 1.05, cz + 0.01); ctl.target.set(cx, 0, cz); ctl.update(); };
    reset();
    const dono = (h: THREE.Intersection): number => (h.object === boxes ? boxDono[h.instanceId!] : h.instanceId!);
    api.current = { reset, topo, ir: (id: string) => { const e = ents.find(x => x.p.id.toUpperCase() === id.toUpperCase()); if (!e) return; ctl.target.set(e.x, e.y, e.z); cam.position.set(e.x + (e.x > cx ? -1 : 1) * 4, e.y + 3, e.z + 6); ctl.update(); } };

    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let ultimo = 0; let ativo = -1;
    const qual = (ev: PointerEvent): Pick | null => {
      const b = r.domElement.getBoundingClientRect(); mouse.set(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1); ray.setFromCamera(mouse, cam);
      const h = ray.intersectObjects(pickMeshes, false)[0]; if (!h || h.instanceId === undefined) return null;
      if (modo === 'areas') { const a = areas[h.instanceId]; return { tipo: 'area', rua: a.rua, gal: a.gal, total: a.total, st: a.st }; }
      return { tipo: 'pos', p: ents[dono(h)].p };
    };
    const brilho = (i: number, on: boolean) => { // destaca a pilha sob o mouse
      if (!boxes) return; const e = ents[i]; for (let k = 0; k < 2; k++) boxes.setColorAt(i * 2 + k, corTmp.set(on ? '#ffffff' : e.p.st === 0 ? PAPELAO[(i + k) % 4] : CORES[e.p.st])); if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    };
    const mover = (ev: PointerEvent) => {
      const t = performance.now(); if (t - ultimo < 60) return; ultimo = t; const p = qual(ev);
      if (modo === 'posicoes') { const idx = p && p.tipo === 'pos' ? ents.findIndex(e => e.p === p.p) : -1; if (idx !== ativo) { if (ativo >= 0) brilho(ativo, false); if (idx >= 0) brilho(idx, true); ativo = idx; } }
      setDica(p ? { x: ev.clientX, y: ev.clientY, t: p.tipo === 'pos' ? `${p.p.id} · ${NOMES[p.p.st]}` : `Rua ${p.rua} (${p.gal}) · ${p.total} posições · ${NOMES[p.st]}` } : null);
    };
    let dx = 0, dy = 0;
    const down = (ev: PointerEvent) => { dx = ev.clientX; dy = ev.clientY; };
    const click = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - dx, ev.clientY - dy) > 4) return; const p = qual(ev); if (p && p.tipo === 'pos') abrir(p.p.id); };
    r.domElement.addEventListener('pointermove', mover); r.domElement.addEventListener('pointerdown', down); r.domElement.addEventListener('pointerup', click);
    const ajustar = () => { const w = el.clientWidth, h = el.clientHeight; r.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    ajustar(); const ro = new ResizeObserver(ajustar); ro.observe(el);
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); ctl.update(); r.render(scene, cam); }; loop();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); ctl.dispose(); api.current = {};
      r.domElement.removeEventListener('pointermove', mover); r.domElement.removeEventListener('pointerdown', down); r.domElement.removeEventListener('pointerup', click);
      scene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) mat.dispose(); });
      cache.forEach(t => t.dispose()); r.dispose(); if (r.domElement.parentNode === el) el.removeChild(r.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estrutura, filtrados, modo]);

  const achar = () => { const p = itens.find(i => i.id.toUpperCase() === busca.trim().toUpperCase()); if (!p) { setErrD('Posição não encontrada na base ativa.'); return; } if (galpao && p.gal !== galpao) setGalpao(p.gal); if (modo === 'posicoes') setTimeout(() => api.current.ir?.(p.id), 60); abrir(p.id); };
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
          <div className="ml-auto flex gap-2"><button className="btn btn-secondary" onClick={() => api.current.reset?.()}>Visão geral</button><button className="btn btn-secondary" onClick={() => api.current.topo?.()}>Vista de cima</button><button className="btn btn-secondary" onClick={recarregar}>Atualizar</button></div>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">{NOMES.map((n, i) => <button key={i} onClick={() => setOculto(s => { const x = new Set(s); x.has(i) ? x.delete(i) : x.add(i); return x; })}
          className={`chip ${oculto.has(i) ? 'chip-off opacity-50 line-through' : 'chip-off'}`}><span className="h-3 w-3 rounded-sm" style={{ background: CORES[i] }} />{n}</button>)}<span className="self-center text-xs text-slate-500">Clique na legenda para ocultar/mostrar · arraste para girar · role para aproximar · clique em uma posição para ver os dados</span></div>
        <div ref={host} className="h-[68vh] min-h-[460px] w-full overflow-hidden rounded-2xl ring-1 ring-slate-300" />
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
