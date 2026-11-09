// Pointy-top axial hex coordinates.

export const HEX_R = 22; // centre-to-corner radius in world units
export const HEX_W = Math.sqrt(3) * HEX_R; // width, also centre-to-centre distance
export const HEX_INNER = HEX_W / 2; // centre-to-edge distance

export const DIRS: ReadonlyArray<[number, number]> = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function hexToPixel(q: number, r: number): [number, number] {
  return [HEX_W * (q + r / 2), HEX_R * 1.5 * r];
}

export function pixelToHex(x: number, y: number): [number, number] {
  const qf = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / HEX_R;
  const rf = ((2 / 3) * y) / HEX_R;
  return hexRound(qf, rf);
}

export function hexRound(qf: number, rf: number): [number, number] {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

export function hexDist(q1: number, r1: number, q2 = 0, r2 = 0): number {
  const dq = q1 - q2, dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Corner points of a hex centred at (x, y). */
export function hexCorners(x: number, y: number, rad: number): [number, number][] {
  const p: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    p.push([x + rad * Math.cos(a), y + rad * Math.sin(a)]);
  }
  return p;
}

export function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number) {
  const c = hexCorners(x, y, rad);
  ctx.moveTo(c[0][0], c[0][1]);
  for (let i = 1; i < 6; i++) ctx.lineTo(c[i][0], c[i][1]);
  ctx.closePath();
}
