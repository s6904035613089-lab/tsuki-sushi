/* =============================================================
   gen-images.mjs — สร้างโลโก้และภาพเมนูทั้งหมดเป็น SVG
   รัน:  node tools/gen-images.mjs
   แก้เมนู/สีได้ที่ตัวแปร MENU ท้ายไฟล์ แล้วรันใหม่
   ============================================================= */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'assets', 'images');
mkdirSync(join(IMG, 'menu'), { recursive: true });

/* ---------------------------------------------------- จานสีแบรนด์ */
const C = {
  indigo: '#151a33', indigo2: '#232a4d', red: '#e0323c', redDeep: '#b8202c',
  gold: '#e8b45a', cream: '#f8f4ec', cream2: '#efe7d7', ink: '#2b2f45',
  rice: '#fbf7f0', riceShadow: '#e6ddcd', nori: '#2c3a2f', noriLight: '#3f5243'
};

const rnd = (seed) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; };

/* ---------------------------------------------------- ชิ้นส่วนที่ใช้ซ้ำ */
const plate = (bg1, bg2) => `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/>
    </linearGradient>
    <radialGradient id="dish" cx="50%" cy="46%" r="52%">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ece4d6"/>
    </radialGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="9" flood-color="#1c1430" flood-opacity=".22"/>
    </filter>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <circle cx="200" cy="205" r="140" fill="url(#dish)" opacity=".96"/>
  <circle cx="200" cy="205" r="140" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="3"/>`;

/** ก้อนข้าวปั้น (nigiri) มองจากด้านข้างเฉียง */
function nigiri(fish, { x = 200, y = 215, band = false, sear = false, egg = false } = {}) {
  return `
  <g filter="url(#soft)">
    <ellipse cx="${x}" cy="${y + 26}" rx="92" ry="34" fill="${C.rice}"/>
    <ellipse cx="${x}" cy="${y + 34}" rx="92" ry="26" fill="${C.riceShadow}"/>
    <ellipse cx="${x}" cy="${y + 26}" rx="92" ry="34" fill="none" stroke="#e3d8c6" stroke-width="2"/>
    <path d="M${x - 98} ${y} q98 -46 196 0 q-22 30 -98 30 q-76 0 -98 -30z" fill="${fish}"/>
    <path d="M${x - 98} ${y} q98 -46 196 0 q-22 30 -98 30 q-76 0 -98 -30z" fill="none" stroke="#00000022" stroke-width="2"/>
    ${egg ? `<rect x="${x - 96}" y="${y - 20}" width="192" height="44" rx="10" fill="${fish}" stroke="#00000018" stroke-width="2"/>` : ''}
    ${sear ? `<path d="M${x - 78} ${y - 6} q78 -22 156 0" fill="none" stroke="#8c3a22" stroke-opacity=".55" stroke-width="7" stroke-linecap="round"/>` : ''}
    ${band ? `<rect x="${x - 26}" y="${y - 22}" width="52" height="84" rx="6" fill="${C.nori}"/>` : ''}
  </g>`;
}

/** ไส้ในของมากิแบบตัดขวาง */
function maki(fills, seed = 7) {
  const r = rnd(seed);
  const dots = Array.from({ length: 22 }, () => {
    const a = r() * Math.PI * 2, d = 44 + r() * 44;
    return `<circle cx="${(200 + Math.cos(a) * d).toFixed(1)}" cy="${(205 + Math.sin(a) * d).toFixed(1)}" r="${(4 + r() * 3).toFixed(1)}" fill="#ffffff" opacity=".85"/>`;
  }).join('');
  const inner = fills.map((f, i) => {
    const a = (i / fills.length) * Math.PI * 2;
    return `<circle cx="${(200 + Math.cos(a) * (fills.length > 1 ? 20 : 0)).toFixed(1)}" cy="${(205 + Math.sin(a) * (fills.length > 1 ? 20 : 0)).toFixed(1)}" r="${fills.length > 1 ? 19 : 26}" fill="${f}"/>`;
  }).join('');
  return `
  <g filter="url(#soft)">
    <circle cx="200" cy="205" r="104" fill="${C.nori}"/>
    <circle cx="200" cy="205" r="96" fill="${C.rice}"/>
    ${dots}
    <circle cx="200" cy="205" r="46" fill="${C.riceShadow}" opacity=".5"/>
    ${inner}
    <circle cx="200" cy="205" r="104" fill="none" stroke="#00000022" stroke-width="2"/>
  </g>`;
}

/** ซาชิมิวางเรียง */
function sashimi(colors) {
  return `<g filter="url(#soft)">
    ${colors.map((c, i) => {
      const x = 118 + i * 58, y = 150 + (i % 2) * 18;
      return `<g transform="rotate(-16 ${x} ${y})">
        <rect x="${x}" y="${y}" width="66" height="112" rx="16" fill="${c}"/>
        <path d="M${x + 8} ${y + 24} h50 M${x + 8} ${y + 54} h50 M${x + 8} ${y + 84} h50"
              stroke="#ffffff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>
      </g>`;
    }).join('')}
    <path d="M150 316 q50 -18 100 0" stroke="#7bbf6a" stroke-width="10" fill="none" stroke-linecap="round" opacity=".8"/>
  </g>`;
}

/** ชามข้าว / ชามเส้น */
function bowl(topping, { noodle = false, egg = false, nori = false } = {}) {
  return `
  <g filter="url(#soft)">
    <path d="M78 178 h244 a8 8 0 0 1 8 9 l-20 96 a58 58 0 0 1 -57 49 h-106 a58 58 0 0 1 -57 -49 l-20 -96 a8 8 0 0 1 8 -9z" fill="${C.indigo}"/>
    <path d="M78 178 h244 a8 8 0 0 1 8 9 l-4 20 h-252 l-4 -20 a8 8 0 0 1 8 -9z" fill="${C.indigo2}"/>
    <ellipse cx="200" cy="180" rx="122" ry="26" fill="${noodle ? '#e7c86c' : C.rice}"/>
    ${noodle ? `<g stroke="#d8b354" stroke-width="4" fill="none" opacity=".8">
        <path d="M110 176 q40 -14 80 0 M130 186 q40 -14 80 0 M170 172 q40 -14 80 0 M200 186 q40 -14 78 0"/></g>` : ''}
    ${topping}
    ${egg ? `<g><ellipse cx="146" cy="172" rx="30" ry="22" fill="#fdf6ea"/><ellipse cx="146" cy="172" rx="15" ry="12" fill="#f0a93b"/></g>` : ''}
    ${nori ? `<rect x="232" y="142" width="46" height="52" rx="4" fill="${C.nori}" transform="rotate(8 255 168)"/>` : ''}
    <path d="M96 196 q104 26 208 0" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="4"/>
  </g>`;
}

/** ของทานเล่นวางบนจาน (รูปทรงซ้ำ ๆ) */
function pieces(shape, color, n = 4, accent = null) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const cx = 200 + Math.cos((i / n) * Math.PI * 2 + 0.6) * 62;
    const cy = 205 + Math.sin((i / n) * Math.PI * 2 + 0.6) * 44;
    const rot = -20 + i * 24;
    if (shape === 'gyoza') {
      out.push(`<g transform="rotate(${rot} ${cx} ${cy})">
        <path d="M${cx - 50} ${cy + 12} q50 -50 100 0 q-50 24 -100 0z" fill="${color}"/>
        <path d="M${cx - 44} ${cy + 6} q12 -14 18 0 q12 -14 18 0 q12 -14 18 0 q12 -14 18 0" fill="none" stroke="#c9a06a" stroke-width="4"/>
      </g>`);
    } else if (shape === 'tempura') {
      out.push(`<g transform="rotate(${rot} ${cx} ${cy})">
        <rect x="${cx - 18}" y="${cy - 52}" width="36" height="104" rx="18" fill="${color}"/>
        <path d="M${cx - 16} ${cy - 40} q16 10 32 -2 M${cx - 16} ${cy - 4} q16 10 32 -2 M${cx - 16} ${cy + 30} q16 10 32 -2"
              fill="none" stroke="#d99a4e" stroke-width="4" opacity=".7"/>
        ${accent ? `<ellipse cx="${cx}" cy="${cy + 56}" rx="14" ry="10" fill="${accent}"/>` : ''}
      </g>`);
    } else if (shape === 'ball') {
      out.push(`<g><circle cx="${cx}" cy="${cy}" r="34" fill="${color}"/>
        <ellipse cx="${cx - 10}" cy="${cy - 12}" rx="11" ry="8" fill="#ffffff" opacity=".45"/>
        ${accent ? `<path d="M${cx - 26} ${cy - 20} q26 16 52 0" stroke="${accent}" stroke-width="6" fill="none" stroke-linecap="round"/>` : ''}</g>`);
    } else {
      out.push(`<rect x="${cx - 30}" y="${cy - 24}" width="60" height="48" rx="12" fill="${color}" transform="rotate(${rot} ${cx} ${cy})"/>`);
    }
  }
  return `<g filter="url(#soft)">${out.join('')}</g>`;
}

/** แก้วเครื่องดื่ม */
function drink(liquid, { hot = false, bottle = false } = {}) {
  if (bottle) return `
  <g filter="url(#soft)">
    <path d="M168 96 h64 v34 q0 12 12 22 q18 15 18 40 v96 a26 26 0 0 1 -26 26 h-72 a26 26 0 0 1 -26 -26 v-96 q0 -25 18 -40 q12 -10 12 -22z" fill="${liquid}" opacity=".9"/>
    <path d="M168 96 h64 v20 h-64z" fill="#c9d3dd"/>
    <path d="M160 200 h80" stroke="#ffffff" stroke-opacity=".5" stroke-width="6"/>
    <ellipse cx="180" cy="250" rx="10" ry="26" fill="#ffffff" opacity=".28"/>
  </g>`;
  if (hot) return `
  <g filter="url(#soft)">
    <path d="M196 96 q-16 20 0 40 M216 90 q-16 22 0 44" stroke="#ffffff" stroke-opacity=".6" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="M120 168 h160 l-16 108 a34 34 0 0 1 -34 28 h-60 a34 34 0 0 1 -34 -28z" fill="${C.cream}"/>
    <ellipse cx="200" cy="170" rx="80" ry="20" fill="${liquid}"/>
    <path d="M280 186 q34 6 30 36 q-4 30 -38 26" fill="none" stroke="${C.cream}" stroke-width="12" stroke-linecap="round"/>
  </g>`;
  return `
  <g filter="url(#soft)">
    <path d="M132 130 h136 l-18 158 a26 26 0 0 1 -26 23 h-48 a26 26 0 0 1 -26 -23z" fill="#ffffff" opacity=".55"/>
    <path d="M140 178 h120 l-14 110 a22 22 0 0 1 -22 19 h-48 a22 22 0 0 1 -22 -19z" fill="${liquid}"/>
    <ellipse cx="200" cy="178" rx="60" ry="13" fill="#ffffff" opacity=".4"/>
    <rect x="214" y="96" width="12" height="96" rx="6" fill="#ffffff" opacity=".7" transform="rotate(12 220 144)"/>
  </g>`;
}

/* ---------------------------------------------------- ประกอบไฟล์ */
const svg = (inner, bg1, bg2) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400" role="img">
${plate(bg1, bg2)}
${inner}
</svg>
`;

/* ---------------------------------------------------- โลโก้ */
const moonMark = (size = 120) => `
  <defs>
    <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff5a52"/><stop offset="1" stop-color="${C.redDeep}"/>
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="56" fill="url(#mg)"/>
  <path d="M84 30 a34 34 0 1 0 0 60 a42 42 0 0 1 0 -60z" fill="${C.cream}" opacity=".95"/>
  <g transform="translate(60 74) rotate(-8)">
    <ellipse cx="0" cy="6" rx="34" ry="12" fill="${C.cream}"/>
    <path d="M-34 0 q34 -18 68 0 q-8 11 -34 11 q-26 0 -34 -11z" fill="#ffd2c2"/>
  </g>
  <circle cx="60" cy="60" r="56" fill="none" stroke="${C.gold}" stroke-width="3" opacity=".85"/>`;

writeFileSync(join(IMG, 'logo-mark.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">${moonMark()}</svg>\n`);

writeFileSync(join(IMG, 'logo.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 120" width="460" height="120" role="img" aria-label="Tsuki Sushi">
  ${moonMark()}
  <text x="140" y="56" font-family="Quicksand, Poppins, Segoe UI, sans-serif" font-size="42" font-weight="700" fill="currentColor" letter-spacing="1">TSUKI</text>
  <text x="140" y="92" font-family="Quicksand, Poppins, Segoe UI, sans-serif" font-size="27" font-weight="600" fill="${C.red}" letter-spacing="7">SUSHI</text>
  <text x="300" y="92" font-family="Kanit, Segoe UI, sans-serif" font-size="17" fill="currentColor" opacity=".6">ซูชิ สึกิ</text>
</svg>\n`);

writeFileSync(join(IMG, 'placeholder.svg'),
  svg(`<g filter="url(#soft)"><circle cx="200" cy="205" r="76" fill="#dcd3c3"/>
   <text x="200" y="222" text-anchor="middle" font-size="64" opacity=".5">🍣</text></g>`, '#2a3154', '#151a33'));

/* ---------------------------------------------------- เมนูทั้งหมด */
const BG = {
  nigiri:  ['#2f3c63', '#1a2140'], maki: ['#334065', '#1b2344'], sashimi: ['#2b3a5e', '#171d3a'],
  don:     ['#3a3560', '#1d1a3a'], side: ['#40355a', '#201a38'], noodle: ['#33405f', '#1a2139'],
  dessert: ['#4a3352', '#241832'], drink: ['#26405a', '#141f33']
};

const FISH = { salmon: '#f68a52', tuna: '#d6404f', hamachi: '#f4d9a3', ebi: '#f2a08c', egg: '#f4c542', unagi: '#8a5a33', engawa: '#ecdcc6', squid: '#f6f1ea' };

export const MENU = [
  /* ---- ซูชิหน้าปลา ---- */
  { code: 'N01', cat: 'nigiri', file: 'salmon-nigiri',   art: () => nigiri(FISH.salmon) },
  { code: 'N02', cat: 'nigiri', file: 'tuna-nigiri',     art: () => nigiri(FISH.tuna) },
  { code: 'N03', cat: 'nigiri', file: 'hamachi-nigiri',  art: () => nigiri(FISH.hamachi) },
  { code: 'N04', cat: 'nigiri', file: 'ebi-nigiri',      art: () => nigiri(FISH.ebi) },
  { code: 'N05', cat: 'nigiri', file: 'tamago-nigiri',   art: () => nigiri(FISH.egg, { band: true, egg: true }) },
  { code: 'N06', cat: 'nigiri', file: 'unagi-nigiri',    art: () => nigiri(FISH.unagi, { band: true }) },
  { code: 'N07', cat: 'nigiri', file: 'aburi-salmon',    art: () => nigiri(FISH.salmon, { sear: true }) },
  { code: 'N08', cat: 'nigiri', file: 'engawa-nigiri',   art: () => nigiri(FISH.engawa) },
  /* ---- มากิ / โรล ---- */
  { code: 'M01', cat: 'maki', file: 'california-roll',   art: () => maki(['#f2a08c', '#8fc46a', '#f4c542'], 11) },
  { code: 'M02', cat: 'maki', file: 'salmon-roll',       art: () => maki([FISH.salmon], 13) },
  { code: 'M03', cat: 'maki', file: 'spicy-tuna-roll',   art: () => maki([FISH.tuna, '#e8622f'], 17) },
  { code: 'M04', cat: 'maki', file: 'ebi-tempura-roll',  art: () => maki(['#e0a855', '#8fc46a'], 19) },
  { code: 'M05', cat: 'maki', file: 'avocado-maki',      art: () => maki(['#8fc46a'], 23) },
  /* ---- ซาชิมิ ---- */
  { code: 'S01', cat: 'sashimi', file: 'salmon-sashimi', art: () => sashimi([FISH.salmon, FISH.salmon, FISH.salmon]) },
  { code: 'S02', cat: 'sashimi', file: 'tuna-sashimi',   art: () => sashimi([FISH.tuna, FISH.tuna, FISH.tuna]) },
  { code: 'S03', cat: 'sashimi', file: 'mixed-sashimi',  art: () => sashimi([FISH.salmon, FISH.tuna, FISH.hamachi]) },
  /* ---- ข้าวหน้า ---- */
  { code: 'D01', cat: 'don', file: 'salmon-don',  art: () => bowl(`<g>${[0,1,2,3,4].map(i=>`<rect x="${132+i*28}" y="${146+(i%2)*14}" width="46" height="34" rx="9" fill="${FISH.salmon}" transform="rotate(-14 ${155+i*28} ${163})"/>`).join('')}</g>`, { nori: true }) },
  { code: 'D02', cat: 'don', file: 'unagi-don',   art: () => bowl(`<g><rect x="126" y="142" width="148" height="44" rx="10" fill="${FISH.unagi}"/><path d="M134 152 h132 M134 164 h132 M134 176 h132" stroke="#6d4526" stroke-width="3" opacity=".7"/></g>`, { nori: true }) },
  { code: 'D03', cat: 'don', file: 'chirashi-don', art: () => bowl(`<g>
      <rect x="120" y="148" width="50" height="32" rx="8" fill="${FISH.salmon}" transform="rotate(-12 145 164)"/>
      <rect x="176" y="142" width="50" height="32" rx="8" fill="${FISH.tuna}" transform="rotate(8 201 158)"/>
      <rect x="232" y="152" width="46" height="30" rx="8" fill="${FISH.hamachi}" transform="rotate(-6 255 167)"/>
      <circle cx="160" cy="186" r="9" fill="#f2820f"/><circle cx="240" cy="188" r="9" fill="#f2820f"/></g>`, { egg: false, nori: true }) },
  { code: 'D04', cat: 'don', file: 'tendon',      art: () => bowl(`<g>${[0,1,2].map(i=>`<rect x="${140+i*44}" y="130" width="34" height="62" rx="16" fill="#e0a855" transform="rotate(${-12+i*12} ${157+i*44} 160)"/>`).join('')}</g>`) },
  /* ---- ทานเล่น ---- */
  { code: 'A01', cat: 'side', file: 'gyoza',        art: () => pieces('gyoza', '#e7c48a', 4) },
  { code: 'A02', cat: 'side', file: 'ebi-tempura',  art: () => pieces('tempura', '#e0a855', 4, FISH.ebi) },
  { code: 'A03', cat: 'side', file: 'takoyaki',     art: () => pieces('ball', '#d99a4e', 4, '#7a4a22') },
  { code: 'A04', cat: 'side', file: 'edamame',      art: () => pieces('gyoza', '#7cb342', 5) },
  { code: 'A05', cat: 'side', file: 'agedashi-tofu', art: () => pieces('block', '#f0e2c0', 4) },
  { code: 'A06', cat: 'side', file: 'karaage',      art: () => pieces('ball', '#e2a44f', 5) },
  /* ---- เส้น ---- */
  { code: 'R01', cat: 'noodle', file: 'shoyu-ramen',   art: () => bowl(`<rect x="230" y="140" width="44" height="44" rx="8" fill="#c98a52"/>`, { noodle: true, egg: true, nori: true }) },
  { code: 'R02', cat: 'noodle', file: 'tonkotsu-ramen', art: () => bowl(`<rect x="226" y="138" width="48" height="46" rx="10" fill="#e0a07a"/>`, { noodle: true, egg: true, nori: true }) },
  { code: 'R03', cat: 'noodle', file: 'nabeyaki-udon',  art: () => bowl(`<rect x="228" y="134" width="40" height="56" rx="16" fill="#e0a855"/>`, { noodle: true, egg: true }) },
  /* ---- ของหวาน ---- */
  { code: 'W01', cat: 'dessert', file: 'mochi-ice',   art: () => pieces('ball', '#f7c9d9', 3, '#9bd4c0') },
  { code: 'W02', cat: 'dessert', file: 'matcha-lava', art: () => pieces('ball', '#8fbf6a', 2, '#4e7a3a') },
  { code: 'W03', cat: 'dessert', file: 'dorayaki',    art: () => pieces('ball', '#d9a564', 3, '#6b4322') },
  /* ---- เครื่องดื่ม ---- */
  { code: 'B01', cat: 'drink', file: 'green-tea',  art: () => drink('#9dc45f', { hot: true }) },
  { code: 'B02', cat: 'drink', file: 'ramune',     art: () => drink('#7ec8e3', { bottle: true }) },
  { code: 'B03', cat: 'drink', file: 'yuzu-soda',  art: () => drink('#f2c94c') },
  { code: 'B04', cat: 'drink', file: 'cola',       art: () => drink('#6b3a26') }
];

let n = 0;
for (const m of MENU) {
  const [b1, b2] = BG[m.cat];
  writeFileSync(join(IMG, 'menu', `${m.file}.svg`), svg(m.art(), b1, b2));
  n++;
}
console.log(`✔ สร้างรูปเมนู ${n} ไฟล์ + โลโก้ 3 ไฟล์ ที่ assets/images/`);
