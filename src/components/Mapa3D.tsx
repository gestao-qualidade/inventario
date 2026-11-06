'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { rpc, msgErro } from '@/lib/rpc';
import { Alerta, Barra, Carregando, Kpi, Modal, fmt, useCarregar } from './ui';
import ProdutoFoto from './ProdutoFoto';
import Lotes from './Lotes';

type Dados = { versao: string; galpoes: string[]; posicoes: [string, number, number][]; contagem: Record<string, number>; cobertura: { total: number; inventariadas: number; percentual: number } };
const NOMES = ['Não inventariada', 'Em andamento', 'Concluída sem divergência', 'Concluída com divergência', 'Pendente de tratativa', 'Fora deste inventário'];
const CORES = ['#b5834a', '#2f6bff', '#22a35a', '#f5c400', '#e63946', '#cbd5e1'];
const PAPELAO = ['#b5834a', '#a8763f', '#c2925c', '#9c6f3a'];
const COL_SPACING = 1.35, LEVEL_HEIGHT = 1.9, RACK_DEPTH = 1.15, AISLE_WIDTH = 3.4, CORRIDOR_GAP = 2.6;
const BASE_Y = 0.15, BEAM = 0.08, POST = 0.12, PALLET_H = 0.16, COLUMN_TAG_STEP = 5;
const LIMITE = 15000; // máximo de posições desenhadas de uma vez (mantém o 3D leve)

type P = { id: string; gal: string; st: number; rua: string; col: number; alt: number };
type Pick = { tipo: 'pos'; p: P } | { tipo: 'area'; rua: string; total: number; st: number };
const parse = (id: string, gal: string, st: number): P => {
  const s = id.toUpperCase().split('.'); const n = (x?: string) => (x && /^\d+$/.test(x) ? parseInt(x, 10) : 0);
  return { id, gal, st, rua: s[0] || '?', col: Math.max(1, n(s[1])), alt: Math.max(1, n(s[2])) };
};
const cmpNat = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true });
function corredores(ruas: string[]) {
  const c: { left: string | null; right: string | null }[] = [];
  if (!ruas.length) return c;
  c.push({ left: null, right: ruas[0] });
  for (let i = 1; i < ruas.length; i += 2) c.push({ left: ruas[i], right: ruas[i + 1] ?? null });
  return c;
}
const estadoRua = (a: number[]) => { const tot = a.slice(0, 5).reduce((s, v) => s + v, 0); return a[4] > 0 ? 4 : tot && a[0] === tot ? 0 : tot && a[2] + a[3] === tot ? (a[3] ? 3 : 2) : 1; };

export default function Mapa3D() {
  const [inv, setInv] = useState('');
  const invs = useCarregar<any[]>(() => rpc('inventario.listar'), []);
  const { dados, erro, carregando, recarregar } = useCarregar<Dados>(() => rpc('mapa.dados', inv ? { invId: inv } : {}), [inv]);
  const [visao, setVisao] = useState<'estante' | 'galpao'>('estante');
  const [oculto, setOculto] = useState<Set<number>>(new Set());
  const [galpao, setGalpao] = useState(''); const [busca, setBusca] = useState(''); const [filtroRua, setFiltroRua] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [cDe, setCDe] = useState(''); const [cAte, setCAte] = useState(''); const [alts, setAlts] = useState<Set<number>>(new Set());
  const [dica, setDica] = useState<{ x: number; y: number; t: string } | null>(null);
  const [detalhe, setDetalhe] = useState<any>(null); const [errD, setErrD] = useState(''); const [aviso, setAviso] = useState('');
  const [atualizando, setAtualizando] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ reset?: () => void; topo?: () => void; ir?: (id: string) => void }>({});

  const itens = useMemo(() => {
    const nomes: string[] = Array.isArray(dados?.galpoes) ? dados!.galpoes : [];
    return (Array.isArray(dados?.posicoes) ? dados!.posicoes : []).map(([id, g, st]: any) => parse(String(id), typeof g === 'number' ? (nomes[g] ?? '') : String(g ?? ''), Number(st) || 0));
  }, [dados]);
  const galpoes = useMemo(() => [...new Set(itens.filter(i => i.st !== 5).map(i => i.gal))].sort(cmpNat), [itens]);
  useEffect(() => { if (galpoes.length && !galpoes.includes(galpao)) setGalpao(galpoes[0]); }, [galpoes, galpao]);
  useEffect(() => { setOculto(inv ? new Set([5]) : new Set()); }, [inv]);

  const doGalpao = useMemo(() => itens.filter(i => i.gal === galpao), [itens, galpao]);
  // resumo por rua (contagem por status) para o painel lateral
  const ruas = useMemo(() => {
    const m = new Map<string, { cont: number[]; maxCol: number; maxAlt: number }>();
    doGalpao.forEach(p => { const r = m.get(p.rua) || { cont: [0, 0, 0, 0, 0, 0], maxCol: 0, maxAlt: 0 }; r.cont[p.st]++; r.maxCol = Math.max(r.maxCol, p.col); r.maxAlt = Math.max(r.maxAlt, p.alt); m.set(p.rua, r); });
    return [...m.entries()].sort((a, b) => cmpNat(a[0], b[0])).map(([rua, v]) => ({ rua, ...v, total: v.cont.slice(0, 5).reduce((s, x) => s + x, 0) })).filter(r => !inv || r.total > 0);
  }, [doGalpao, inv]);
  const ruasVis = useMemo(() => ruas.filter(r => !filtroRua.trim() || r.rua.toUpperCase().includes(filtroRua.trim().toUpperCase())), [ruas, filtroRua]);
  const maxAltGal = useMemo(() => Math.max(1, ...ruas.map(r => r.maxAlt)), [ruas]);

  // ao trocar de galpão, já seleciona as primeiras ruas (visão leve e útil de imediato)
  useEffect(() => { setSel(ruas.slice(0, 3).map(r => r.rua)); setCDe(''); setCAte(''); setAlts(new Set()); setFiltroRua(''); }, [galpao]); // eslint-disable-line

  const ruasSel = useMemo(() => ruas.map(r => r.rua).filter(r => sel.includes(r)), [ruas, sel]);
  const lo = Math.max(1, parseInt(cDe) || 1), hi = parseInt(cAte) || 1e9;
  const filtrados = useMemo(() => {
    const base = visao === 'galpao' ? doGalpao : doGalpao.filter(p => sel.includes(p.rua) && p.col >= lo && p.col <= hi && (!alts.size || alts.has(p.alt)));
    return base.filter(p => !oculto.has(p.st)).slice(0, visao === 'galpao' ? 1e9 : LIMITE);
  }, [doGalpao, sel, lo, hi, alts, oculto, visao]);

  const abrir = async (id: string) => {
    setErrD(''); setDetalhe({ posicao: id, carregando: true });
    try { setDetalhe(await rpc('mapa.posicao', { posicao: id })); } catch (e) { setErrD(msgErro(e)); setDetalhe({ posicao: id }); }
  };

  useEffect(() => {
    const el = host.current; if (!el || !doGalpao.length) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf2f1ec);
    let r: THREE.WebGLRenderer;
    try { r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); } catch { setAviso('Seu navegador não conseguiu iniciar o 3D (WebGL desativado). Ative a aceleração de hardware ou use outro navegador.'); return; }
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); el.appendChild(r.domElement);
    const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const sol = new THREE.DirectionalLight(0xffffff, 0.9); scene.add(sol);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd6d6, 0.6));
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1a4fc4, roughness: 0.35, metalness: 0.55 });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xf07d1a, roughness: 0.35, metalness: 0.5 });
    const aisleMat = new THREE.MeshStandardMaterial({ color: 0xc9be87, roughness: 0.85, transparent: true, opacity: 0.28 });
    const dummy = new THREE.Object3D(); const corTmp = new THREE.Color();
    const cache = new Map<string, THREE.CanvasTexture>();
    const rotulo = (txt: string, x: number, y: number, z: number, o: { cor?: string; w?: number; big?: boolean } = {}) => {
      const k = txt + '|' + (o.big ? 1 : 0) + '|' + (o.cor || ''); let tex = cache.get(k);
      if (!tex) {
        const cv = document.createElement('canvas'); cv.width = o.big ? 512 : 96; cv.height = o.big ? 144 : 48; const g = cv.getContext('2d')!;
        g.fillStyle = o.cor || '#8a6512'; g.font = `bold ${o.big ? 96 : 30}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, cv.width / 2, cv.height / 2);
        tex = new THREE.CanvasTexture(cv); cache.set(k, tex);
      }
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true })); sp.position.set(x, y, z);
      const w = o.w || (o.big ? 3.6 : 0.85); sp.scale.set(w, w * (o.big ? 144 / 512 : 0.5), 1); scene.add(sp);
    };

    // monta SOMENTE as ruas escolhidas (ou, na visão do galpão, todas — só como blocos)
    const ruasDesenho = visao === 'galpao' ? ruas.map(x => x.rua) : ruasSel;
    const info = new Map(ruas.map(x => [x.rua, x])); const cs = corredores(ruasDesenho); const span = AISLE_WIDTH + RACK_DEPTH * 2 + CORRIDOR_GAP;
    const ruaX: Record<string, number> = {};
    cs.forEach((c, i) => { const cx = i * span; if (c.left) ruaX[c.left] = cx - AISLE_WIDTH / 2 - RACK_DEPTH / 2; if (c.right) ruaX[c.right] = cx + AISLE_WIDTH / 2 + RACK_DEPTH / 2; });
    const colIni = visao === 'galpao' ? 1 : lo;
    const colFim = (rua: string) => Math.min(info.get(rua)?.maxCol || 1, visao === 'galpao' ? 1e9 : hi);
    const zDe = (col: number) => (col - colIni + 0.5) * COL_SPACING;
    let maxD = 1; ruasDesenho.forEach(x => { maxD = Math.max(maxD, (colFim(x) - colIni + 1) * COL_SPACING); });
    const totalW = cs.length * span; let maxTop = 0;

    cs.forEach((_, ci) => { const a = new THREE.Mesh(new THREE.PlaneGeometry(AISLE_WIDTH * 0.94, maxD), aisleMat); a.rotation.x = -Math.PI / 2; a.position.set(ci * span, 0.01, maxD / 2); scene.add(a); });

    type Ent = { p: P; x: number; z: number; y: number };
    const ents: Ent[] = []; const areas: { rua: string; x: number; z: number; w: number; h: number; d: number; total: number; st: number }[] = [];
    const porRua = new Map<string, P[]>(); filtrados.forEach(p => { const a = porRua.get(p.rua) || []; a.push(p); porRua.set(p.rua, a); });

    if (visao === 'estante') {
      let nPost = 0, nBeam = 0;
      ruasDesenho.forEach(x => { const nc = colFim(x) - colIni + 1; nPost += (nc + 1) * 2; nBeam += ((info.get(x)?.maxAlt || 1) + 1) * 2; });
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(POST, 1, POST), postMat, Math.max(1, nPost));
      const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(BEAM, BEAM, 1), beamMat, Math.max(1, nBeam));
      let pi = 0, bi = 0;
      ruasDesenho.forEach(rua => {
        const x = ruaX[rua]; if (x === undefined) return; const mn = info.get(rua)?.maxAlt || 1, nc = colFim(rua) - colIni + 1, prof = nc * COL_SPACING, topo = mn * LEVEL_HEIGHT + BASE_Y + 0.3; maxTop = Math.max(maxTop, topo);
        for (let k = 0; k <= nc; k++) [-RACK_DEPTH / 2, RACK_DEPTH / 2].forEach(o => { dummy.position.set(x + o, topo / 2, k * COL_SPACING); dummy.scale.set(1, topo, 1); dummy.updateMatrix(); posts.setMatrixAt(pi++, dummy.matrix); });
        for (let k = 0; k <= mn; k++) [-RACK_DEPTH / 2, RACK_DEPTH / 2].forEach(o => { dummy.position.set(x + o, BASE_Y + k * LEVEL_HEIGHT, prof / 2); dummy.scale.set(1, 1, prof + 0.3); dummy.updateMatrix(); beams.setMatrixAt(bi++, dummy.matrix); });
        rotulo(rua, x, topo + 0.7, -1.4, { big: true, cor: '#1c2b3a', w: 5.5 });
        for (let c = colIni; c <= colFim(rua); c++) if (c % COLUMN_TAG_STEP === 0 || c === colIni) rotulo(String(c).padStart(2, '0'), x, 0.28, zDe(c) - COL_SPACING / 2 + 0.05, { cor: '#8a6512' });
        (porRua.get(rua) || []).forEach(p => ents.push({ p, x, z: zDe(p.col), y: BASE_Y + (p.alt - 1) * LEVEL_HEIGHT }));
      });
      [posts, beams].forEach(m => { m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; scene.add(m); });
    } else {
      ruasDesenho.forEach(rua => {
        const x = ruaX[rua]; if (x === undefined) return; const inf = info.get(rua)!; const cont = [0, 0, 0, 0, 0]; (porRua.get(rua) || []).forEach(p => cont[p.st]++);
        const tot = cont.reduce((s, v) => s + v, 0); if (!tot) return; const h = inf.maxAlt * LEVEL_HEIGHT, d = inf.maxCol * COL_SPACING; maxTop = Math.max(maxTop, h + 1);
        areas.push({ rua, x, z: d / 2, w: RACK_DEPTH * 0.96, h, d, total: tot, st: estadoRua(cont) });
        rotulo(rua, x, h + 1.2, -1.4, { big: true, cor: '#1c2b3a', w: 5.5 });
      });
    }
    const piso = new THREE.Mesh(new THREE.PlaneGeometry(totalW + 60, maxD + 60), new THREE.MeshBasicMaterial({ color: 0xe8e6dd }));
    piso.rotation.x = -Math.PI / 2; piso.position.set(totalW / 2 - span / 2, 0, maxD / 2); scene.add(piso);

    let pickMeshes: THREE.InstancedMesh[] = []; const boxDono: number[] = []; let boxes: THREE.InstancedMesh | null = null;
    if (visao === 'estante') {
      const pallet = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.92 }), Math.max(1, ents.length));
      boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 }), Math.max(1, ents.length * 2));
      const palX = RACK_DEPTH * 0.8, palZ = COL_SPACING * 0.86, sy = LEVEL_HEIGHT * 0.38; let k2 = 0;
      ents.forEach((e, i) => {
        dummy.position.set(e.x, e.y + PALLET_H / 2 + 0.02, e.z); dummy.scale.set(palX, PALLET_H, palZ); dummy.updateMatrix(); pallet.setMatrixAt(i, dummy.matrix); pallet.setColorAt(i, corTmp.set('#e3c99a'));
        [-1, 1].forEach((s, k) => {
          dummy.position.set(e.x + s * RACK_DEPTH * 0.19, e.y + PALLET_H + 0.03 + sy / 2, e.z); dummy.scale.set(RACK_DEPTH * 0.34, sy, COL_SPACING * 0.62); dummy.updateMatrix();
          boxes!.setMatrixAt(k2, dummy.matrix); boxes!.setColorAt(k2, corTmp.set(e.p.st === 0 ? PAPELAO[(i + k) % 4] : CORES[e.p.st])); boxDono[k2] = i; k2++;
        });
      });
      [pallet, boxes].forEach(m => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.frustumCulled = false; scene.add(m); });
      pickMeshes = [pallet, boxes];
    } else {
      const am = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), Math.max(1, areas.length));
      areas.forEach((a, i) => { dummy.position.set(a.x, BASE_Y + a.h / 2 + 0.2, a.z); dummy.scale.set(a.w, a.h, a.d); dummy.updateMatrix(); am.setMatrixAt(i, dummy.matrix); am.setColorAt(i, corTmp.set(a.st === 0 ? '#c2925c' : CORES[a.st])); });
      am.instanceMatrix.needsUpdate = true; if (am.instanceColor) am.instanceColor.needsUpdate = true; am.frustumCulled = false; scene.add(am); pickMeshes = [am];
    }

    const ctl = new OrbitControls(cam, r.domElement); ctl.enableDamping = true; ctl.maxPolarAngle = Math.PI / 2 - 0.04; ctl.minDistance = 3;
    const cx = totalW / 2 - span / 2, cz = maxD / 2, grande = Math.max(totalW, maxD, 14);
    ctl.maxDistance = grande * 4; scene.fog = new THREE.Fog(0xf2f1ec, grande * 2.5, grande * 7); sol.position.set(cx + 25, 35 + maxTop, cz + 18);
    const reset = () => { cam.position.set(cx, Math.max(maxTop * 1.3, grande * 0.4), maxD + grande * 0.7); ctl.target.set(cx, maxTop * 0.3, cz); ctl.update(); };
    const topo = () => { cam.position.set(cx, grande * 1.1, cz + 0.01); ctl.target.set(cx, 0, cz); ctl.update(); };
    reset();
    api.current = { reset, topo, ir: (id: string) => { const e = ents.find(x => x.p.id.toUpperCase() === id.toUpperCase()); if (!e) return; ctl.target.set(e.x, e.y, e.z); cam.position.set(e.x + (e.x > cx ? -1 : 1) * 4, e.y + 3, e.z + 7); ctl.update(); } };

    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let ultimo = 0, ativo = -1;
    const qual = (ev: PointerEvent): Pick | null => {
      const b = r.domElement.getBoundingClientRect(); mouse.set(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1); ray.setFromCamera(mouse, cam);
      const h = ray.intersectObjects(pickMeshes, false)[0]; if (!h || h.instanceId === undefined) return null;
      if (visao === 'galpao') { const a = areas[h.instanceId]; return { tipo: 'area', rua: a.rua, total: a.total, st: a.st }; }
      return { tipo: 'pos', p: ents[h.object === boxes ? boxDono[h.instanceId] : h.instanceId].p };
    };
    const brilho = (i: number, on: boolean) => { if (!boxes) return; for (let k = 0; k < 2; k++) boxes.setColorAt(i * 2 + k, corTmp.set(on ? '#ffffff' : ents[i].p.st === 0 ? PAPELAO[(i + k) % 4] : CORES[ents[i].p.st])); if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true; };
    const mover = (ev: PointerEvent) => {
      const t = performance.now(); if (t - ultimo < 60) return; ultimo = t; const p = qual(ev);
      if (visao === 'estante') { const idx = p && p.tipo === 'pos' ? ents.findIndex(e => e.p === p.p) : -1; if (idx !== ativo) { if (ativo >= 0) brilho(ativo, false); if (idx >= 0) brilho(idx, true); ativo = idx; } }
      setDica(p ? { x: ev.clientX, y: ev.clientY, t: p.tipo === 'pos' ? `${p.p.id} · ${NOMES[p.p.st]}` : `Rua ${p.rua} · ${p.total} posições · ${NOMES[p.st]} · clique para abrir` } : null);
    };
    let dx = 0, dy = 0; const down = (ev: PointerEvent) => { dx = ev.clientX; dy = ev.clientY; };
    const click = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - dx, ev.clientY - dy) > 4) return; const p = qual(ev); if (!p) return;
      if (p.tipo === 'pos') abrir(p.p.id); else { setSel([p.rua]); setCDe(''); setCAte(''); setVisao('estante'); }
    };
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
  }, [filtrados, visao, ruas]);

  // limite de segurança: se a seleção for grande demais, avisa e corta
  useEffect(() => {
    if (visao === 'estante') { const n = doGalpao.filter(p => sel.includes(p.rua) && p.col >= lo && p.col <= hi && (!alts.size || alts.has(p.alt)) && !oculto.has(p.st)).length; setAviso(n > LIMITE ? `Muitas posições (${fmt(n)}). Para o 3D não travar, estou mostrando só as ${fmt(LIMITE)} primeiras — escolha menos ruas ou use os filtros de coluna e nível.` : ''); }
    else setAviso('');
  }, [doGalpao, sel, lo, hi, alts, oculto, visao]);

  const achar = () => {
    const q = busca.trim().toUpperCase(); const p = itens.find(i => i.id.toUpperCase() === q || i.id.toUpperCase().replace(/\.0+(\d)/g, '.$1') === q.replace(/\.0+(\d)/g, '.$1'));
    if (!p) { setErrD('Posição não encontrada na base ativa.'); return; }
    setErrD(''); setVisao('estante'); setGalpao(p.gal);
    setTimeout(() => { setSel([p.rua]); setCDe(String(Math.max(1, p.col - 12))); setCAte(String(p.col + 12)); setAlts(new Set()); setTimeout(() => api.current.ir?.(p.id), 250); }, 60);
    abrir(p.id);
  };
  const atualizar = async () => { setAtualizando(true); try { await rpc('mapa.dados', { forcar: true, ...(inv ? { invId: inv } : {}) }); recarregar(); } finally { setAtualizando(false); } };
  const alternarRua = (rua: string) => setSel(s => s.includes(rua) ? s.filter(x => x !== rua) : [...s, rua]);

  if (carregando) return <Carregando texto="Carregando o mapa…" />;
  if (erro || !dados) return <Alerta>{erro}</Alerta>;
  const c = dados.contagem || { nao: 0, andamento: 0, ok: 0, divergente: 0, pendente: 0 };
  const cob = dados.cobertura || { total: 0, inventariadas: 0, percentual: 0 };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Kpi rotulo="Cobertura (posições únicas)" valor={`${cob.percentual}%`} sub={`${fmt(cob.inventariadas)} de ${fmt(cob.total)}`} />
        {[0, 1, 2, 3, 4].map(i => <Kpi key={i} rotulo={NOMES[i]} valor={fmt([c.nao, c.andamento, c.ok, c.divergente, c.pendente][i])} cor="" />)}
      </div>
      <Barra pct={cob.percentual} />
      <div className="card !p-3">
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-bold uppercase text-slate-500">Colorir por inventário</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[{ id: '', nome: 'Todos os inventários', status: '' }, ...(invs.dados || []).filter((i: any) => ['ATIVO', 'ENCERRADO'].includes(i.status))].map((i: any) => (
              <button key={i.id || 'todos'} onClick={() => setInv(i.id)} className={`chip whitespace-nowrap ${inv === i.id ? 'chip-on' : 'chip-off'}`}>
                {i.nome}{i.tipo ? <span className="ml-1 text-[10px] opacity-70">· {i.tipo}{i.status === 'ENCERRADO' ? ' · encerrado' : ''}</span> : null}</button>))}
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div><div className="text-[11px] font-bold uppercase text-slate-500">Galpão</div>
            <select className="input !w-auto" value={galpao} onChange={e => setGalpao(e.target.value)}>{galpoes.map(g => <option key={g}>{g}</option>)}</select></div>
          <div><div className="text-[11px] font-bold uppercase text-slate-500">Visão</div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1">{([['estante', 'Estantes (detalhe)'], ['galpao', 'Galpão inteiro']] as const).map(([m, t]) => <button key={m} onClick={() => setVisao(m)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${visao === m ? 'bg-white text-blue-700 shadow' : 'text-slate-500'}`}>{t}</button>)}</div></div>
          <div><div className="text-[11px] font-bold uppercase text-slate-500">Achar posição</div>
            <div className="flex gap-2"><input className="input !w-44" placeholder="ex.: I.25.2" value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && achar()} /><button className="btn btn-secondary" onClick={achar}>Ir</button></div></div>
          {visao === 'estante' && <>
            <div><div className="text-[11px] font-bold uppercase text-slate-500">Colunas</div>
              <div className="flex items-center gap-1"><input className="input !w-20" inputMode="numeric" placeholder="de" value={cDe} onChange={e => setCDe(e.target.value.replace(/\D/g, ''))} /><span className="text-slate-400">–</span><input className="input !w-20" inputMode="numeric" placeholder="até" value={cAte} onChange={e => setCAte(e.target.value.replace(/\D/g, ''))} /></div></div>
            <div><div className="text-[11px] font-bold uppercase text-slate-500">Altura (nível)</div>
              <div className="flex flex-wrap gap-1">{Array.from({ length: maxAltGal }, (_, i) => i + 1).map(n => <button key={n} onClick={() => setAlts(s => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; })} className={`chip ${alts.has(n) ? 'chip-on' : 'chip-off'} !px-2.5`}>{n}</button>)}</div></div>
          </>}
          <div className="ml-auto flex gap-2"><button className="btn btn-secondary" onClick={() => api.current.reset?.()}>Visão geral</button><button className="btn btn-secondary" onClick={() => api.current.topo?.()}>Vista de cima</button><button className="btn btn-secondary" disabled={atualizando} onClick={atualizar}>{atualizando ? 'Atualizando…' : 'Atualizar'}</button></div>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">{NOMES.map((n, i) => i === 5 && !inv ? null : <button key={i} onClick={() => setOculto(s => { const x = new Set(s); x.has(i) ? x.delete(i) : x.add(i); return x; })}
          className={`chip ${oculto.has(i) ? 'chip-off opacity-50 line-through' : 'chip-off'}`}><span className="h-3 w-3 rounded-sm" style={{ background: CORES[i] }} />{n}</button>)}
          <span className="text-xs text-slate-500">Clique na cor para mostrar/ocultar o status</span></div>
        {aviso && <div className="mb-2"><Alerta tipo="aviso">{aviso}</Alerta></div>}
        <div className="grid gap-3 lg:grid-cols-[270px_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-white/60 p-2">
            <div className="mb-2"><div className="text-sm font-bold">Ruas de {galpao} <span className="font-normal text-slate-500">({ruas.length} · {sel.length} marcadas)</span></div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold"><button className="rounded-lg bg-blue-600 px-2.5 py-1 text-white" onClick={() => setSel(ruasVis.map(r => r.rua))}>Selecionar todas{filtroRua.trim() ? ' (filtradas)' : ''}</button><button className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700" onClick={() => setSel(ruasVis.slice(0, 6).map(r => r.rua))}>6 primeiras</button><button className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-700" onClick={() => setSel([])}>Limpar</button></div></div>
            <input className="input !py-1.5 mb-2" placeholder="Filtrar rua…" value={filtroRua} onChange={e => setFiltroRua(e.target.value)} />
            <div className="max-h-[56vh] space-y-1 overflow-y-auto pr-1">
              {ruasVis.map(r => { const on = sel.includes(r.rua); return (
                <button key={r.rua} onClick={() => { if (visao === 'galpao') { setSel([r.rua]); setVisao('estante'); } else alternarRua(r.rua); }}
                  className={`w-full rounded-xl border px-2.5 py-1.5 text-left ${on ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                  <div className="flex items-center justify-between text-sm font-bold"><span>{on && visao === 'estante' ? '☑' : '☐'} Rua {r.rua}</span><span className="text-xs font-semibold text-slate-500">{fmt(r.total)} pos. · {r.maxCol} col × {r.maxAlt} níveis</span></div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-200">{r.cont.map((v, i) => v ? <div key={i} style={{ width: `${(v / r.total) * 100}%`, background: CORES[i] }} /> : null)}</div>
                </button>); })}
              {!ruasVis.length && <div className="p-2 text-sm text-slate-500">Nenhuma rua com esse nome.</div>}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{visao === 'galpao' ? 'Clique numa rua para abrir as estantes dela.' : 'Marque as ruas que quer ver. Quanto menos ruas, mais rápido.'}</p>
          </div>
          <div ref={host} className="h-[68vh] min-h-[460px] w-full overflow-hidden rounded-2xl ring-1 ring-slate-300" />
        </div>
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
                    <td className="td text-xs"><Lotes lotes={i.lotes} /></td><td className="td text-xs">{i.status}</td></tr>)}</tbody></table></div>}</div>
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
