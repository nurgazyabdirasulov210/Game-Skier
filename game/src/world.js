// Мир ЦЕЛИНЫ: единая функция высоты склона.
// Реализована дважды — на JS (физика, расстановка объектов) и на GLSL (рендер),
// с целочисленным хэшем, чтобы GPU и CPU давали один и тот же рельеф.

export const SLOPE = 0.36;      // средний уклон склона (вниз по +Z)
export const POWDER = 0.52;     // толщина свежего пухляка над «базой»
export const LATTICE_OFS = 1 << 20;

// ---------------------------------------------------------------- JS

function hashU(x, y) {
  let h = (Math.imul((x + LATTICE_OFS) | 0, 0x8da6b343) ^ Math.imul((y + LATTICE_OFS) | 0, 0xd8163841)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
export function hash01(x, y) { return Math.fround(hashU(x, y)) / 4294967296; }

function gnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let h, gx, gy;
  h = hashU(ix, iy); gx = (h & 0xffff) / 32767.5 - 1; gy = (h >>> 16) / 32767.5 - 1;
  const a = gx * fx + gy * fy;
  h = hashU(ix + 1, iy); gx = (h & 0xffff) / 32767.5 - 1; gy = (h >>> 16) / 32767.5 - 1;
  const b = gx * (fx - 1) + gy * fy;
  h = hashU(ix, iy + 1); gx = (h & 0xffff) / 32767.5 - 1; gy = (h >>> 16) / 32767.5 - 1;
  const c = gx * fx + gy * (fy - 1);
  h = hashU(ix + 1, iy + 1); gx = (h & 0xffff) / 32767.5 - 1; gy = (h >>> 16) / 32767.5 - 1;
  const d = gx * (fx - 1) + gy * (fy - 1);
  const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
  return (ab + (cd - ab) * uy) * 1.6;
}
export { gnoise };

function fbm(x, y, oct) {
  let s = 0, a = 0.5;
  for (let i = 0; i < oct; i++) {
    s += a * gnoise(x, y);
    const nx = 1.6 * x - 1.2 * y + 17.3;
    const ny = 1.2 * x + 1.6 * y - 9.1;
    x = nx; y = ny; a *= 0.5;
  }
  return s;
}

const smooth = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

// Кикер (естественный трамплин) в ячейке 48 м
export const KICK_CELL = 48;
export function kickerInfo(cx, cz) {
  const h1 = hash01(cx * 3 + 11, cz * 7 + 5);
  if (h1 > 0.42) return null;
  const jx = hash01(cx + 101, cz + 13), jz = hash01(cx + 7, cz + 211);
  const x = cx * KICK_CELL + 14 + jx * 20;
  const z = cz * KICK_CELL + 14 + jz * 20;
  const yaw = (hash01(cx + 31, cz + 77) - 0.5) * 0.7;
  const L = 6.5 + hash01(cx + 5, cz + 9) * 4.5;
  const H = 1.3 + hash01(cx + 19, cz + 3) * 1.3;
  const W = 3.6 + hash01(cx + 41, cz + 29) * 2.4;
  return { x, z, yaw, L, H, W };
}
function kickerAt(x, z) {
  const cx = Math.floor(x / KICK_CELL), cz = Math.floor(z / KICK_CELL);
  const k = kickerInfo(cx, cz);
  if (!k) return 0;
  const dx = x - k.x, dz = z - k.z;
  const c = Math.cos(k.yaw), s = Math.sin(k.yaw);
  const lx = c * dx - s * dz, lz = s * dx + c * dz;
  const t = Math.min(Math.max((lz + k.L) / k.L, 0), 1);
  const ramp = k.H * t * t * (lz < 0 ? 1 : 1 - smooth(0, 3.2, lz));
  const side = 1 - smooth(k.W * 0.55, k.W, Math.abs(lx));
  return ramp * side;
}
export { kickerAt };

// Базовая высота (твёрдый наст под пухляком)
export function heightAt(x, z) {
  const wx = gnoise(x * 0.004 + 3.1, z * 0.004 + 7.7) * 45;
  const wz = gnoise(x * 0.004 + 11.3, z * 0.004 - 4.2) * 45;
  const qx = x + wx, qz = z + wz;
  let h = -z * SLOPE;
  h += fbm(qx / 320, qz / 520, 3) * 34;
  // кулуары — извилистые желоба вдоль склона
  const g = gnoise(qx / 140 + 5.2, qz / 420 + 1.3);
  const gv = 1 - smooth(0, 0.24, Math.abs(g));
  h -= 10 * gv * gv;
  // средние перекаты
  h += fbm(qx / 70, qz / 70, 2) * 6;
  // подушки
  h += gnoise(x / 11, z / 11) * 0.9 + gnoise(x / 5.3 + 3, z / 5.3 + 3) * 0.25;
  // скальные пояса со сбросами
  const m = smooth(0.12, 0.45, gnoise(x / 260 + 8, z / 260 + 2));
  const u = (z + gnoise(x / 120, 0.5) * 25) / 75;
  const b = fract(u);
  const st = smooth(0.88, 0.94, b);
  const lip = Math.exp(-(((b - 0.86) / 0.025) ** 2)) * 0.8;
  h += m * (5.5 * (b - st) + lip);
  // трамплины
  h += kickerAt(x, z);
  return h;
}

export function snowHeightAt(x, z) { return heightAt(x, z) + POWDER; }

export function normalAt(x, z, out, e = 0.35) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  let nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  out.x = nx / l; out.y = ny / l; out.z = nz / l;
  return out;
}

// Биом 0..1: 0 — густой ельник, 1 — открытая альпика
export function biomeAt(x, z) {
  const v = fbm(x / 900 + 41.7, z / 1100 - 13.2, 2) * 1.3 + 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
export function forestAt(x, z) {
  // пятна леса и поляны
  return fbm(x / 70 + 5.5, z / 70 - 2.5, 3);
}
export function cliffMask(x, z) {
  return smooth(0.12, 0.45, gnoise(x / 260 + 8, z / 260 + 2));
}

// ---------------------------------------------------------------- GLSL

export const GLSL_WORLD = /* glsl */`
#define SLOPE ${SLOPE.toFixed(4)}
#define POWDER ${POWDER.toFixed(4)}
#define KICK_CELL ${KICK_CELL.toFixed(1)}
uint hashU(ivec2 p){
  uvec2 q = uvec2(p + ivec2(${LATTICE_OFS}));
  uint h = (q.x * 0x8da6b343u) ^ (q.y * 0xd8163841u);
  h ^= h >> 16u; h *= 0x7feb352du;
  h ^= h >> 15u; h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}
float hash01(ivec2 p){ return float(hashU(p)) * (1.0/4294967296.0); }
vec2 gradU(uint h){ return vec2(float(h & 0xffffu), float(h >> 16u)) / 32767.5 - 1.0; }
float gnoise(vec2 x){
  vec2 i = floor(x); vec2 f = x - i;
  ivec2 ii = ivec2(i);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float a = dot(gradU(hashU(ii)), f);
  float b = dot(gradU(hashU(ii+ivec2(1,0))), f-vec2(1.0,0.0));
  float c = dot(gradU(hashU(ii+ivec2(0,1))), f-vec2(0.0,1.0));
  float d = dot(gradU(hashU(ii+ivec2(1,1))), f-vec2(1.0,1.0));
  float ab = a + (b-a)*u.x, cd = c + (d-c)*u.x;
  return (ab + (cd-ab)*u.y) * 1.6;
}
float fbm2(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<2;i++){ s += a*gnoise(p); p = vec2(1.6*p.x-1.2*p.y+17.3, 1.2*p.x+1.6*p.y-9.1); a*=0.5; }
  return s;
}
float fbm3(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<3;i++){ s += a*gnoise(p); p = vec2(1.6*p.x-1.2*p.y+17.3, 1.2*p.x+1.6*p.y-9.1); a*=0.5; }
  return s;
}
float kickerAt(vec2 p){
  ivec2 c = ivec2(floor(p / KICK_CELL));
  float h1 = hash01(ivec2(c.x*3+11, c.y*7+5));
  if (h1 > 0.42) return 0.0;
  float jx = hash01(c + ivec2(101,13)), jz = hash01(c + ivec2(7,211));
  vec2 k = vec2(c) * KICK_CELL + 14.0 + vec2(jx, jz) * 20.0;
  float yaw = (hash01(c + ivec2(31,77)) - 0.5) * 0.7;
  float L = 6.5 + hash01(c + ivec2(5,9)) * 4.5;
  float H = 1.3 + hash01(c + ivec2(19,3)) * 1.3;
  float W = 3.6 + hash01(c + ivec2(41,29)) * 2.4;
  vec2 d = p - k;
  float cs = cos(yaw), sn = sin(yaw);
  float lx = cs*d.x - sn*d.y, lz = sn*d.x + cs*d.y;
  float t = clamp((lz + L)/L, 0.0, 1.0);
  float ramp = H*t*t*(lz < 0.0 ? 1.0 : 1.0 - smoothstep(0.0, 3.2, lz));
  return ramp * (1.0 - smoothstep(W*0.55, W, abs(lx)));
}
float heightAt(vec2 p){
  vec2 w = vec2(gnoise(p*0.004 + vec2(3.1,7.7)), gnoise(p*0.004 + vec2(11.3,-4.2))) * 45.0;
  vec2 q = p + w;
  float h = -p.y * SLOPE;
  h += fbm3(vec2(q.x/320.0, q.y/520.0)) * 34.0;
  float g = gnoise(vec2(q.x/140.0 + 5.2, q.y/420.0 + 1.3));
  float gv = 1.0 - smoothstep(0.0, 0.24, abs(g));
  h -= 10.0*gv*gv;
  h += fbm2(q/70.0) * 6.0;
  h += gnoise(p/11.0)*0.9 + gnoise(p/5.3 + 3.0)*0.25;
  float m = smoothstep(0.12, 0.45, gnoise(p/260.0 + vec2(8.0,2.0)));
  float u = (p.y + gnoise(vec2(p.x/120.0, 0.5))*25.0)/75.0;
  float b = fract(u);
  float st = smoothstep(0.88, 0.94, b);
  float lb = (b-0.86)/0.025;
  float lip = exp(-lb*lb)*0.8;
  h += m*(5.5*(b - st) + lip);
  h += kickerAt(p);
  return h;
}
vec3 normalAt(vec2 p, float e){
  float hx = heightAt(p+vec2(e,0.0)) - heightAt(p-vec2(e,0.0));
  float hz = heightAt(p+vec2(0.0,e)) - heightAt(p-vec2(0.0,e));
  return normalize(vec3(-hx, 2.0*e, -hz));
}
`;
