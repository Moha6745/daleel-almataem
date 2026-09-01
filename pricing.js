/* ==========================================================
   الحسابات
   ========================================================== */
const money = n => Math.round(n*100)/100;
const fmt = n => (Math.round(n*10)/10).toLocaleString('ar-SA',{maximumFractionDigits:1});

// سعر صنف معيّن داخل تطبيق معيّن
function itemPrice(rest, item, appKey){
  const a = rest.apps[appKey];
  if(!a || !a.on) return null;
  return money(item.base * a.mult);
}

// حساب سلة (قائمة أصناف) عبر كل التطبيقات
function compare(rest, items){
  const rows = APP_KEYS.map(k=>{
    const a = rest.apps[k];
    if(!a || !a.on) return {key:k, on:false};
    const sub = items.reduce((s,it)=> s + item2(it,a), 0);
    return {key:k, on:true, sub:money(sub), fee:a.fee, total:money(sub+a.fee), mult:a.mult};
  });
  const live = rows.filter(r=>r.on);
  const best = live.length ? live.reduce((m,r)=> r.total < m.total ? r : m) : null;
  const worst = live.length ? live.reduce((m,r)=> r.total > m.total ? r : m) : null;
  return {rows, best, worst, saving: best&&worst ? money(worst.total-best.total) : 0};
}
function item2(it,a){ return it.base * a.mult; }

// أرخص تطبيق بناءً على المنيو كامل (يُستخدم في البطاقات)
function bestApp(rest){
  return compare(rest, rest.menu).best;
}
