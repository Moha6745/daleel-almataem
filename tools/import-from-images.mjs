#!/usr/bin/env node
/* ==========================================================
   استيراد المنيو والأسعار من لقطات شاشة
   ----------------------------------------------------------
   تصوّر منيو المطعم داخل كل تطبيق من جوالك، تحط الصور في
   menu-images/ بأسماء <id>-<app>.png، والسكربت يقرأها ويكتب
   الأصناف والأسعار في data.js ويرفع علم verified.

   ما فيه أي اتصال بسيرفرات جاهز/هنقر/كيتا — الصور من شاشتك أنت.

   الاستخدام:
     npm install
     export ANTHROPIC_API_KEY="sk-ant-..."
     node tools/import-from-images.mjs --dry        # عرض بدون تعديل
     node tools/import-from-images.mjs              # كتابة في data.js
     node tools/import-from-images.mjs --only=albaik
     node tools/import-from-images.mjs --effort=high

   راجع menu-images/README.md لتسمية الصور.
   ========================================================== */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, basename } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'data.js');
const IMG_DIR = join(ROOT, 'menu-images');

const MODEL = 'claude-opus-5';
const PRICE_IN = 5 / 1_000_000;    // $ لكل توكن إدخال
const PRICE_OUT = 25 / 1_000_000;  // $ لكل توكن إخراج

const APP_KEYS = ['jahez', 'hunger', 'keeta'];
const APP_NAMES = { jahez: 'جاهز', hunger: 'هنقرستيشن', keeta: 'كيتا', branch: 'سعر الفرع' };
const MEDIA = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7).split(',').map(s=>s.trim()).filter(Boolean);
const effort = (args.find(a => a.startsWith('--effort=')) || '').slice(9) || 'medium';

/* ---------- مخطط المخرجات ---------- */
const Money = z.number().nullable();
const Extracted = z.object({
  items: z.array(z.object({
    name: z.string().describe('اسم الصنف بالعربي كما هو مكتوب في الصورة'),
    description: z.string().describe('وصف مختصر للصنف، أو نص فارغ لو ما فيه وصف'),
    prices: z.object({
      branch: Money.describe('سعر الفرع بالريال، أو null'),
      jahez: Money.describe('السعر داخل جاهز بالريال، أو null'),
      hunger: Money.describe('السعر داخل هنقرستيشن بالريال، أو null'),
      keeta: Money.describe('السعر داخل كيتا بالريال، أو null')
    })
  })).describe('الأصناف، وكل صنف مطابَق عبر الصور المختلفة لنفس المطعم'),
  deliveryFees: z.object({
    jahez: Money, hunger: Money, keeta: Money
  }).describe('رسوم التوصيل الظاهرة في كل تطبيق بالريال، و0 يعني توصيل مجاني'),
  notes: z.string().describe('أي ملاحظة عن صور غير واضحة أو أصناف ما قدرت تطابقها')
});

const SYSTEM = `أنت تستخرج بيانات منيو مطاعم من لقطات شاشة تطبيقات توصيل سعودية.

قواعد صارمة:
- استخرج فقط ما هو **مقروء فعلاً** في الصور. لا تخمّن ولا تكمّل من معرفتك بالمطعم.
- سعر غير ظاهر أو غير مقروء = null. لا تضع رقماً تقريبياً أبداً.
- الأسعار بالريال السعودي كأرقام فقط (39.5 وليس "39.50 ر.س").
- إذا ظهر نفس الصنف في أكثر من صورة (تطبيقات مختلفة)، اجمعه في سطر واحد
  واملأ سعر كل تطبيق في خانته. طابق بالاسم والوصف والحجم.
- الأسعار المشطوبة (قبل الخصم) تُتجاهل؛ خذ السعر المعروض للدفع.
- إذا كانت صورة غير واضحة أو ناقصة، اذكرها في notes بدل ما تخترع بيانات.`;

/* ---------- تجميع الصور حسب المطعم ---------- */
if (!existsSync(IMG_DIR)) { console.error(`✖ ما فيه مجلد ${IMG_DIR}`); process.exit(1); }

const groups = new Map(); // id -> [{app, file, path}]
for (const f of readdirSync(IMG_DIR)) {
  const ext = extname(f).toLowerCase();
  if (!MEDIA[ext]) continue;
  const m = basename(f, ext).match(/^(.+?)-(jahez|hunger|keeta|branch)(?:-\d+)?$/);
  if (!m) { console.log(`… تجاهلت ${f} (الاسم ما يطابق <id>-<app>)`); continue; }
  const [, id, app] = m;
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push({ app, file: f, path: join(IMG_DIR, f), media: MEDIA[ext] });
}

if (!groups.size) {
  console.error('✖ ما فيه صور صالحة في menu-images/ — راجع menu-images/README.md');
  process.exit(1);
}

/* ---------- تحميل البيانات الحالية ---------- */
const src0 = readFileSync(DATA_FILE, 'utf8');
const DATA = new Function(`${src0}\nreturn DATA;`)();
const byId = new Map(DATA.map(r => [r.id, r]));

const targets = [...groups.keys()].filter(id => (!only.length || only.includes(id)));
const unknown = targets.filter(id => !byId.has(id));
if (unknown.length) {
  console.error(`✖ معرّفات ما هي موجودة في data.js: ${unknown.join(', ')}`);
  console.error('  أضف المطعم في data.js أولاً، أو صحّح اسم الصورة.');
  process.exit(1);
}
if (!targets.length) { console.error('✖ ما فيه مطاعم مطابقة لـ --only'); process.exit(1); }

const client = new Anthropic();

/* ---------- استخراج مطعم واحد ---------- */
async function extract(rest, imgs) {
  const content = [];
  for (const img of imgs) {
    content.push({ type: 'text', text: `الصورة التالية: ${APP_NAMES[img.app]} — ${img.file}` });
    content.push({ type: 'image', source: {
      type: 'base64', media_type: img.media,
      data: readFileSync(img.path).toString('base64')
    }});
  }
  content.push({ type: 'text', text:
    `المطعم: ${rest.name}${rest.branch ? ` — ${rest.branch}` : ''}.\n` +
    `استخرج الأصناف وأسعارها من الصور أعلاه، ورسوم التوصيل لكل تطبيق إن ظهرت.` });

  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: zodOutputFormat(Extracted) },
    messages: [{ role: 'user', content }]
  });

  if (res.stop_reason === 'refusal') throw new Error(`رفض النموذج الطلب (${res.stop_details?.category ?? 'بدون سبب'})`);
  if (!res.parsed_output) throw new Error('ما رجع مخرج صالح');
  return { out: res.parsed_output, usage: res.usage };
}

/* ---------- تحويل المستخرَج لصيغة data.js ---------- */
const round2 = n => Math.round(n * 100) / 100;
const median = a => { const s=[...a].sort((x,y)=>x-y); const m=s.length>>1;
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2; };

function toEntry(rest, out) {
  const usable = out.items.filter(it => {
    const p = it.prices;
    return [p.branch, p.jahez, p.hunger, p.keeta].some(v => typeof v === 'number' && v > 0);
  });
  if (!usable.length) throw new Error('ما فيه ولا سعر مقروء في الصور');

  // سعر الأساس: سعر الفرع إن وُجد، وإلا أرخص سعر تطبيق (مع تنبيه)
  let approximated = 0;
  const rows = usable.map(it => {
    const p = it.prices;
    let base = p.branch;
    if (typeof base !== 'number' || base <= 0) {
      const live = APP_KEYS.map(k => p[k]).filter(v => typeof v === 'number' && v > 0);
      base = Math.min(...live);
      approximated++;
    }
    return { it, base: round2(base), p };
  });

  // نسبة كل تطبيق = وسيط (سعر التطبيق ÷ سعر الأساس) عبر الأصناف
  const apps = {};
  for (const k of APP_KEYS) {
    const ratios = rows
      .filter(r => typeof r.p[k] === 'number' && r.p[k] > 0 && r.base > 0)
      .map(r => r.p[k] / r.base);
    const fee = out.deliveryFees[k];
    apps[k] = ratios.length
      ? { on: true, mult: Math.round(median(ratios) * 100) / 100,
          fee: typeof fee === 'number' && fee >= 0 ? round2(fee) : rest.apps[k].fee }
      : { on: false, mult: 1, fee: 0 };
  }

  const menu = rows.map(r => ({ n: r.it.name.trim(), d: (r.it.description || '').trim(), base: r.base }));
  return { entry: { ...rest, apps, menu, verified: true }, approximated, count: rows.length };
}

/* ---------- كتابة كائن مطعم داخل data.js ---------- */
const q = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function serialize(r) {
  const L = [];
  L.push('{');
  L.push(`  id:${q(r.id)}, name:${q(r.name)}, cuisine:${q(r.cuisine)}, district:${q(r.district)},`);
  L.push(`  branch:${q(r.branch)}, verified:true,`);
  L.push(`  rating:${r.rating}, reviewsCount:${r.reviewsCount}, price:${q(r.price)}, eta:${q(r.eta)},`);
  L.push(`  about:${q(r.about)},`);
  L.push(`  apps:{ ${APP_KEYS.map(k => `${k}:{on:${r.apps[k].on},mult:${r.apps[k].mult},fee:${r.apps[k].fee}}`).join(', ')} },`);
  L.push('  menu:[');
  L.push(r.menu.map(m => `    {n:${q(m.n)}, d:${q(m.d)}, base:${m.base}}`).join(',\n'));
  L.push('  ],');
  L.push('  reviews:[');
  L.push(r.reviews.map(v => `    {who:${q(v.who)}, r:${v.r}, dt:${q(v.dt)}, t:${q(v.t)}}`).join(',\n'));
  L.push('  ]');
  L.push('}');
  return L.join('\n');
}

/* يستبدل كائن المطعم في النص اعتماداً على حدود الأسطر */
function spliceEntry(src, id, text) {
  const lines = src.split('\n');
  const at = lines.findIndex(l => l.trimStart().startsWith(`id:"${id}",`));
  if (at === -1) throw new Error(`ما لقيت ${id} في data.js`);
  let start = at; while (start > 0 && lines[start] !== '{') start--;
  if (lines[start] !== '{') throw new Error(`ما لقيت بداية كائن ${id}`);
  let end = at; while (end < lines.length && lines[end] !== '}' && lines[end] !== '},') end++;
  if (end >= lines.length) throw new Error(`ما لقيت نهاية كائن ${id}`);
  const tail = lines[end] === '},' ? ',' : '';
  return [...lines.slice(0, start), text + tail, ...lines.slice(end + 1)].join('\n');
}

/* ---------- التشغيل ---------- */
let out = src0;
let inTok = 0, outTok = 0;
const done = [], failed = [];

for (const id of targets) {
  const rest = byId.get(id);
  const imgs = groups.get(id);
  process.stdout.write(`\n▶ ${rest.name} — ${imgs.length} صورة (${imgs.map(i => APP_NAMES[i.app]).join('، ')})\n`);
  try {
    const { out: parsed, usage } = await extract(rest, imgs);
    inTok += usage.input_tokens; outTok += usage.output_tokens;

    const { entry, approximated, count } = toEntry(rest, parsed);
    console.log(`  ✔ ${count} صنف`);
    for (const k of APP_KEYS) {
      const a = entry.apps[k];
      console.log(`    ${APP_NAMES[k].padEnd(12)} ${a.on ? `زيادة ${Math.round((a.mult-1)*100)}% · توصيل ${a.fee} ر.س` : 'غير متوفر'}`);
    }
    if (approximated) console.log(`  ⚠ ${approximated} صنف بدون سعر فرع — استُخدم أرخص سعر تطبيق كأساس`);
    if (parsed.notes?.trim()) console.log(`  ملاحظة النموذج: ${parsed.notes.trim()}`);

    if (!DRY) out = spliceEntry(out, id, serialize(entry));
    done.push(id);
  } catch (err) {
    console.log(`  ✖ ${err.message}`);
    failed.push(id);
  }
}

const cost = inTok * PRICE_IN + outTok * PRICE_OUT;
console.log(`\n— التوكنات: ${inTok} إدخال / ${outTok} إخراج ≈ $${cost.toFixed(3)}`);

if (!DRY && done.length) {
  try { new Function(`${out}\nreturn DATA;`)(); }
  catch (e) { console.error(`✖ الناتج فيه خطأ صياغة، ما كتبت شي: ${e.message}`); process.exit(1); }
  writeFileSync(DATA_FILE, out);
  console.log(`✔ تحدّث data.js — ${done.length} مطعم: ${done.join(', ')}`);
  console.log('  صاروا "متحقَّق منهم" ووسم «بيانات تجريبية» انشال عنهم.');
} else if (DRY) {
  console.log(`(تجربة فقط) كان بيتحدّث ${done.length} مطعم.`);
}
if (failed.length) console.log(`✖ فشل ${failed.length}: ${failed.join(', ')}`);
