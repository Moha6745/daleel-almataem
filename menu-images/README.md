# صور المنيو

حط هنا لقطات شاشة المنيو من تطبيقات التوصيل، وسمّ كل ملف بـ **معرّف المطعم** (`id` في `data.js`)
ثم اسم التطبيق:

```
menu-images/
  albaik-jahez.png       ← منيو البيك داخل جاهز
  albaik-keeta.png       ← نفس المطعم داخل كيتا
  albaik-hunger.jpg
  kudu-jahez.png
```

أسماء التطبيقات المقبولة: `jahez` · `hunger` · `keeta` · `branch` (سعر الفرع نفسه، من موقع المطعم أو قائمته).

تقدر تحط أكثر من صورة لنفس المطعم والتطبيق بإضافة رقم: `albaik-jahez-2.png`.

بعدها شغّل:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
node tools/import-from-images.mjs --dry
```

الصيغ المدعومة: `png` `jpg` `jpeg` `webp` `gif`.

> هذا المجلد للعمل المحلي — الصور ما تُرفع للمستودع (مستثناة في `.gitignore`).
