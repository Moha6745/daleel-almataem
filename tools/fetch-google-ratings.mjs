#!/usr/bin/env node
/* ==========================================================
   تحديث التقييمات من قوقل ماب
   ----------------------------------------------------------
   يبحث عن كل مطعم في data.js باسمه + فرعه داخل الرياض عبر
   Google Places API (Text Search v1)، ويكتب rating و reviewsCount
   الحقيقيين مكان القيم التقديرية.

   الاستخدام:
     export GOOGLE_MAPS_API_KEY="مفتاحك"
     node tools/fetch-google-ratings.mjs --dry      # عرض بدون تعديل
     node tools/fetch-google-ratings.mjs            # تعديل data.js
     node tools/fetch-google-ratings.mjs --only=albaik,kudu

   المفتاح: console.cloud.google.com → فعّل "Places API (New)"
   → أنشئ API key. الطلبات مدفوعة حسب تسعيرة قوقل.
   ========================================================== */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'data.js');
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7)
  .split(',').map(s => s.trim()).filter(Boolean);

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) {
  console.error('✖ ما فيه مفتاح. شغّل: export GOOGLE_MAPS_API_KEY="..."');
  process.exit(1);
}

const src = readFileSync(DATA_FILE, 'utf8');
const DATA = new Function(`${src}\nreturn DATA;`)();
const targets = only.length ? DATA.filter(r => only.includes(r.id)) : DATA;

if (!targets.length) {
  console.error('✖ ما فيه مطاعم مطابقة لـ --only');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function lookup(rest) {
  const textQuery = `${rest.name} ${rest.branch || ''} الرياض`.trim();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount'
    },
    body: JSON.stringify({ textQuery, languageCode: 'ar', regionCode: 'SA', maxResultCount: 1 })
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  const place = (await res.json()).places?.[0];
  if (!place) throw new Error('ما لقيت الفرع في قوقل ماب');
  if (typeof place.rating !== 'number') throw new Error('الفرع بدون تقييم في قوقل ماب');

  return {
    rating: Math.round(place.rating * 10) / 10,
    reviewsCount: place.userRatingCount ?? 0,
    address: place.formattedAddress || '',
    placeName: place.displayName?.text || ''
  };
}

let out = src;
const changed = [], failed = [];

for (const rest of targets) {
  try {
    const hit = await lookup(rest);
    const moved = hit.rating !== rest.rating || hit.reviewsCount !== rest.reviewsCount;
    console.log(
      `${moved ? '↻' : '='} ${rest.name} — ${rest.branch}\n` +
      `    قوقل: ★${hit.rating} (${hit.reviewsCount}) | عندنا: ★${rest.rating} (${rest.reviewsCount})\n` +
      `    ${hit.placeName} — ${hit.address}`
    );

    if (!DRY) {
      const re = new RegExp(
        `(id:"${rest.id}",[\\s\\S]{0,800}?rating:)([\\d.]+)(, *reviewsCount:)(\\d+)`
      );
      if (!re.test(out)) throw new Error('ما قدرت أحدد مكان التقييم داخل data.js');
      out = out.replace(re, `$1${hit.rating}$3${hit.reviewsCount}`);

      // ارفع علم ratingVerified عشان الواجهة تعرض "تقييم قوقل ماب" بدل "تجريبي"
      if (!rest.ratingVerified) {
        const flag = new RegExp(`(id:"${rest.id}",[\\s\\S]{0,400}?branch:"[^"]*",)`);
        if (!flag.test(out)) throw new Error('ما قدرت أحدد مكان حقل branch داخل data.js');
        out = out.replace(flag, '$1 ratingVerified:true,');
      }
    }
    if (moved || !rest.ratingVerified) changed.push(rest.id);
  } catch (err) {
    console.log(`✖ ${rest.name} — ${rest.branch}: ${err.message}`);
    failed.push(rest.id);
  }
  await sleep(220); // تهدئة بسيطة على الـ API
}

if (!DRY && changed.length) {
  writeFileSync(DATA_FILE, out);
  console.log(`\n✔ تحدّث data.js — ${changed.length} مطعم: ${changed.join(', ')}`);
} else if (DRY) {
  console.log(`\n(تجربة فقط) كان بيتحدّث ${changed.length} مطعم.`);
} else {
  console.log('\n= كل التقييمات محدّثة أصلاً، ما فيه تغيير.');
}
if (failed.length) console.log(`✖ فشل ${failed.length}: ${failed.join(', ')}`);
