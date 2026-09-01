#!/usr/bin/env node
/* ==========================================================
   اكتشاف مطاعم حقيقية من قوقل ماب
   ----------------------------------------------------------
   يبحث في قوقل ماب عن مطاعم الرياض ويضيف الجديد منها إلى data.js
   بأسماء وأحياء وتقييمات حقيقية — بدل ما تُكتب يدوياً أو تُخترع.

   اللي يجي من قوقل (حقيقي):  الاسم · الحي · العنوان · التقييم · عدد التقييمات · مستوى السعر
   اللي يبقى ناقصاً:          المنيو والأسعار داخل التطبيقات
                              → عبّها بـ tools/import-from-images.mjs

   الاستخدام:
     export GOOGLE_MAPS_API_KEY="مفتاحك"
     node tools/discover-restaurants.mjs --dry
     node tools/discover-restaurants.mjs --cuisine=برغر --max=40
     node tools/discover-restaurants.mjs --query="مطاعم مندي في الرياض" --cuisine=سعودي
     node tools/discover-restaurants.mjs --all --max=30      # كل الأنواع

   كل طلب يرجّع ٢٠ نتيجة كحد أقصى، والصفحات الإضافية تُجلب تلقائياً.
   ========================================================== */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'data.js');
const ENDPOINT = process.env.PLACES_ENDPOINT || 'https://places.googleapis.com/v1/places:searchText';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error('✖ ما فيه مفتاح. شغّل: export GOOGLE_MAPS_API_KEY="..."'); process.exit(1); }

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const ALL = args.includes('--all');
const argOf = p => { const a = args.find(x => x.startsWith(p)); return a ? a.slice(p.length) : ''; };
const MAX = Number(argOf('--max=')) || 20;
const oneCuisine = argOf('--cuisine=');
const customQuery = argOf('--query=');

/* استعلام لكل نوع طعام — الأنواع نفسها الموجودة في data.js */
const QUERIES = {
  "برغر":      "مطاعم برغر في الرياض",
  "بيتزا":     "مطاعم بيتزا في الرياض",
  "سعودي":     "مطاعم كبسة ومندي سعودية في الرياض",
  "شاورما":    "مطاعم شاورما في الرياض",
  "دجاج":      "مطاعم دجاج مقلي وبروست في الرياض",
  "مشاوي":     "مطاعم مشاوي وستيك في الرياض",
  "أمريكي":    "مطاعم أمريكية في الرياض",
  "آسيوي":     "مطاعم آسيوية وسوشي في الرياض",
  "معجنات":    "مخابز ومعجنات ومناقيش في الرياض",
  "قهوة وحلا": "مقاهي وحلويات في الرياض"
};

/* نوع قوقل الأساسي → نوع الطعام عندنا (يُستخدم لتصحيح التصنيف) */
const TYPE_MAP = {
  hamburger_restaurant:"برغر", fast_food_restaurant:"برغر",
  pizza_restaurant:"بيتزا", italian_restaurant:"بيتزا",
  middle_eastern_restaurant:"سعودي", lebanese_restaurant:"شاورما",
  chicken_restaurant:"دجاج", fried_chicken_restaurant:"دجاج",
  barbecue_restaurant:"مشاوي", steak_house:"مشاوي", turkish_restaurant:"مشاوي",
  american_restaurant:"أمريكي", mexican_restaurant:"أمريكي", breakfast_restaurant:"أمريكي",
  sandwich_shop:"أمريكي",
  japanese_restaurant:"آسيوي", sushi_restaurant:"آسيوي", chinese_restaurant:"آسيوي",
  thai_restaurant:"آسيوي", indian_restaurant:"آسيوي", asian_restaurant:"آسيوي",
  bakery:"معجنات", bagel_shop:"معجنات",
  coffee_shop:"قهوة وحلا", cafe:"قهوة وحلا", dessert_shop:"قهوة وحلا",
  ice_cream_shop:"قهوة وحلا", donut_shop:"قهوة وحلا", juice_shop:"قهوة وحلا"
};

const PRICE_MAP = {
  PRICE_LEVEL_FREE:"$", PRICE_LEVEL_INEXPENSIVE:"$",
  PRICE_LEVEL_MODERATE:"$$", PRICE_LEVEL_EXPENSIVE:"$$$",
  PRICE_LEVEL_VERY_EXPENSIVE:"$$$"
};

/* حدود الرياض تقريباً — عشان ما تجي نتائج من مدن ثانية */
const RIYADH = { rectangle: {
  low:  { latitude: 24.45, longitude: 46.45 },
  high: { latitude: 25.05, longitude: 47.05 }
}};

const FIELDS = [
  'places.id','places.displayName','places.formattedAddress','places.addressComponents',
  'places.rating','places.userRatingCount','places.priceLevel','places.primaryType',
  'places.editorialSummary','nextPageToken'
].join(',');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(textQuery, want) {
  const found = [];
  let pageToken;
  do {
    const res = await fetch(ENDPOINT, {
      method:'POST',
      headers: { 'Content-Type':'application/json', 'X-Goog-Api-Key':KEY, 'X-Goog-FieldMask':FIELDS },
      body: JSON.stringify({
        textQuery, languageCode:'ar', regionCode:'SA',
        includedType:'restaurant', locationRestriction: RIYADH,
        pageSize: Math.min(20, want - found.length),
        ...(pageToken ? { pageToken } : {})
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0,200)}`);
    const body = await res.json();
    found.push(...(body.places ?? []));
    pageToken = body.nextPageToken;
    if (pageToken && found.length < want) await sleep(2000); // قوقل يحتاج مهلة قبل الصفحة التالية
  } while (pageToken && found.length < want);
  return found.slice(0, want);
}

/* نقل الاسم العربي إلى معرّف لاتيني يصلح لاسم ملف */
const TRANSLIT = {
  'ا':'a','أ':'a','إ':'i','آ':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh',
  'د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z',
  'ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w',
  'ي':'y','ى':'a','ة':'a','ء':'','ؤ':'w','ئ':'y','َ':'','ِ':'','ُ':'','ْ':'','ّ':'','ً':'','ٍ':'','ٌ':''
};
const slug = s => (s.split('').map(c => c in TRANSLIT ? TRANSLIT[c] : (/[a-zA-Z0-9]/.test(c) ? c.toLowerCase() : ' ')).join('')
  .trim().replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'') || 'matam');

/* الحي من مكوّنات العنوان */
function district(place) {
  const comps = place.addressComponents ?? [];
  const hit = comps.find(c => (c.types??[]).some(t =>
    t==='sublocality_level_1' || t==='sublocality' || t==='neighborhood'));
  return (hit?.longText ?? '').replace(/^حي\s+/, '').trim();
}

/* ---------- التشغيل ---------- */
const src0 = readFileSync(DATA_FILE, 'utf8');
const DATA = new Function(`${src0}\nreturn DATA;`)();
const CUISINES = new Function(`${src0}\nreturn CUISINES;`)().slice(1);

const seenIds = new Set(DATA.map(r => r.id));
const seenNames = new Set(DATA.map(r => `${r.name}|${r.district}`));

let jobs;
if (customQuery) jobs = [[oneCuisine || CUISINES[0], customQuery]];
else if (oneCuisine) {
  if (!QUERIES[oneCuisine]) { console.error(`✖ نوع غير معروف: ${oneCuisine}\n  المتاح: ${CUISINES.join('، ')}`); process.exit(1); }
  jobs = [[oneCuisine, QUERIES[oneCuisine]]];
} else if (ALL) jobs = Object.entries(QUERIES);
else { console.error('✖ حدّد --cuisine=<نوع> أو --query="..." أو --all'); process.exit(1); }

const q = s => `"${String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`;
const added = [];
let apiCalls = 0;

for (const [cuisine, query] of jobs) {
  console.log(`\n▶ ${cuisine} — «${query}»`);
  let places;
  try { places = await search(query, MAX); apiCalls++; }
  catch (err) { console.log(`  ✖ ${err.message}`); continue; }

  for (const pl of places) {
    const name = pl.displayName?.text?.trim();
    if (!name) continue;
    if (typeof pl.rating !== 'number') { console.log(`  … ${name} — بدون تقييم، تخطيته`); continue; }

    const dist = district(pl);
    if (seenNames.has(`${name}|${dist}`)) { console.log(`  = ${name} — موجود أصلاً`); continue; }

    let id = slug(name);
    if (dist) id = `${id}-${slug(dist)}`;
    let n = 2; const base = id;
    while (seenIds.has(id)) id = `${base}-${n++}`;

    // نوع قوقل أدق من نوع الاستعلام لما يكون معروفاً
    const cz = TYPE_MAP[pl.primaryType] ?? cuisine;

    added.push({
      id, name, cuisine: cz, district: dist || 'الرياض',
      branch: pl.formattedAddress ? `فرع ${pl.formattedAddress.split('،')[0].trim()}` : 'الفرع الرئيسي',
      rating: Math.round(pl.rating*10)/10,
      reviewsCount: pl.userRatingCount ?? 0,
      price: PRICE_MAP[pl.priceLevel] ?? '$$',
      about: pl.editorialSummary?.text?.trim() ?? '',
      placeId: pl.id
    });
    seenIds.add(id); seenNames.add(`${name}|${dist}`);
    console.log(`  + ${name} — ${dist || 'بدون حي'} · ★${pl.rating} (${pl.userRatingCount ?? 0}) · ${cz}`);
  }
}

console.log(`\n— ${apiCalls} طلب بحث · ${added.length} مطعم جديد`);

if (!added.length) { console.log('ما فيه شي جديد يُضاف.'); process.exit(0); }

const blocks = added.map(r => `{
  id:${q(r.id)}, name:${q(r.name)}, cuisine:${q(r.cuisine)}, district:${q(r.district)},
  branch:${q(r.branch)}, ratingVerified:true,
  rating:${r.rating}, reviewsCount:${r.reviewsCount}, price:${q(r.price)}, eta:"—",
  about:${q(r.about)},
  /* المنيو والأسعار لسه ما تُجمعت — عبّها بـ tools/import-from-images.mjs */
  apps:{ jahez:{on:false,mult:1,fee:0}, hunger:{on:false,mult:1,fee:0}, keeta:{on:false,mult:1,fee:0} },
  menu:[],
  reviews:[]
}`).join(',\n');

if (DRY) { console.log('(تجربة فقط) ما كتبت شي في data.js.'); process.exit(0); }

const marker = '\n];\n';
const at = src0.lastIndexOf(marker);
if (at === -1) { console.error('✖ ما لقيت نهاية مصفوفة DATA في data.js'); process.exit(1); }
const out = src0.slice(0, at) + ',\n/* ---- مضافة من قوقل ماب ---- */\n' + blocks + src0.slice(at);

try { new Function(`${out}\nreturn DATA;`)(); }
catch (e) { console.error(`✖ الناتج فيه خطأ صياغة، ما كتبت شي: ${e.message}`); process.exit(1); }

writeFileSync(DATA_FILE, out);
console.log(`✔ أُضيف ${added.length} مطعم إلى data.js — أسماؤهم وأحياؤهم وتقييماتهم من قوقل ماب.`);
console.log('  ناقصهم المنيو والأسعار: صوّر منيوهم وشغّل tools/import-from-images.mjs');
