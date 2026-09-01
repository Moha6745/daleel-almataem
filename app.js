/* ==========================================================
   الحالة
   ========================================================== */
const state = {
  view:"list", id:null, tab:"menu",
  cuisine:"الكل", q:"", sort:"rating",
  basket:{}, // id -> Set of item indexes
  newRating:0,
  extraReviews:{}
};

/* علمان منفصلان لأن الأسعار والتقييم يجون من مصدرين مختلفين:
     verified        الأسعار اتجمعت فعلاً — يرفعه tools/import-from-images.mjs
     ratingVerified  التقييم اتجمع من قوقل ماب — يرفعه tools/fetch-google-ratings.mjs
   مطعم ممكن يكون أسعاره حقيقية وتقييمه تجريبي، أو العكس. */
const isVerified = r => r.verified === true;
const hasRealRating = r => r.ratingVerified === true;

const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const app = document.getElementById('app');

/* ==========================================================
   عرض القائمة
   ========================================================== */
function filtered(){
  let out = DATA.filter(r=>{
    if(state.cuisine!=="الكل" && r.cuisine!==state.cuisine) return false;
    if(state.q){
      const q = state.q.trim();
      if(!(r.name.includes(q) || r.cuisine.includes(q) || r.district.includes(q) || (r.branch||'').includes(q))) return false;
    }
    return true;
  });
  if(state.sort==="rating") out.sort((a,b)=>b.rating-a.rating);
  if(state.sort==="cheap") out.sort((a,b)=>{
    const A=bestApp(a), B=bestApp(b);
    return (A?A.total:1e9)-(B?B.total:1e9);
  });
  if(state.sort==="reviews") out.sort((a,b)=>b.reviewsCount-a.reviewsCount);
  return out;
}

function chipRow(label, values, current, action){
  return `<div class="frow">
    <div class="flabel">${label}</div>
    <div class="chips">
      ${values.map(v=>`<button class="chip" aria-pressed="${v===current}" data-act="${action}" data-val="${esc(v)}">
        ${CUISINE_EMOJI[v]?`<span class="em">${CUISINE_EMOJI[v]}</span>`:''}${esc(v)}
      </button>`).join('')}
    </div>
  </div>`;
}

function renderList(){
  const list = filtered();
  app.innerHTML = `
  <section class="filters">
    ${chipRow("نوع الطعام", CUISINES, state.cuisine, "cuisine")}
  </section>

  <div class="bar">
    <div class="count"><b>${fmt(list.length)}</b> مطعم مطابق</div>
    <label class="sort">ترتيب حسب
      <select id="sort">
        <option value="rating" ${state.sort==='rating'?'selected':''}>الأعلى تقييماً</option>
        <option value="cheap" ${state.sort==='cheap'?'selected':''}>الأوفر سعراً</option>
        <option value="reviews" ${state.sort==='reviews'?'selected':''}>الأكثر تقييمات</option>
      </select>
    </label>
  </div>

  <div class="grid">
    ${list.length ? list.map(cardHTML).join('') : `
      <div class="empty">
        <div class="big">🍽</div>
        <h3>ما فيه مطاعم بهذي الفلاتر</h3>
        <p>جرّب تغيير نوع الطعام أو امسح البحث.</p>
      </div>`}
  </div>`;
}

function cardHTML(r){
  const b = bestApp(r);
  return `<button class="rcard" data-act="open" data-id="${r.id}">
    <div class="thumb" style="background:${CUISINE_BG[r.cuisine]}">
      ${CUISINE_EMOJI[r.cuisine]}
      <span class="reg">📍 ${esc(r.district)}</span>
      ${isVerified(r) ? '<span class="vflag ok">✅ أسعار حقيقية</span>' : '<span class="vflag">أسعار تجريبية</span>'}
    </div>
    <div class="rbody">
      <div class="rname">${esc(r.name)}</div>
      <div class="rmeta">${esc(r.cuisine)} · ${esc(r.price)}</div>
      <div class="rstats">
        <span><span class="star">★ ${r.rating}</span> <span style="color:var(--ink-soft)">(${fmt(r.reviewsCount)})</span></span>
        <span class="dot">|</span>
        <span>${r.menu.length ? `🛵 ${esc(r.eta)}` : '📋 بلا منيو بعد'}</span>
      </div>
      <div class="apps">
        ${APP_KEYS.map(k=>`<span class="apptag ${r.apps[k].on?'':'off'}">${APPS[k].short}</span>`).join('')}
      </div>
      ${b ? `<div class="best">
        <span class="lbl">الأوفر للمنيو كامل</span>
        <span class="val">${APPS[b.key].name} · ${fmt(b.total)} ر.س</span>
      </div>` : ''}
    </div>
  </button>`;
}

/* ==========================================================
   صفحة المطعم
   ========================================================== */
function getRest(){ return DATA.find(r=>r.id===state.id); }
function basketSet(){
  if(!state.basket[state.id]) state.basket[state.id] = new Set(getRest().menu.map((_,i)=>i));
  return state.basket[state.id];
}

function renderDetail(){
  const r = getRest();
  const sel = basketSet();
  app.innerHTML = `
  <button class="back" data-act="back">→ رجوع للقائمة</button>
  <section class="hero">
    <div class="hero-top" style="background:${CUISINE_BG[r.cuisine]}">${CUISINE_EMOJI[r.cuisine]}</div>
    <div class="hero-in">
      <h1>${esc(r.name)}</h1>
      <div class="sub">${esc(r.cuisine)} · ${esc(r.district)} · الرياض</div>
      <p class="about">${esc(r.about)}</p>
      ${isVerified(r) && hasRealRating(r)
        ? `<p class="branch">الأسعار والتقييم من <b>${esc(r.branch)}</b> —
            <a href="${mapsUrl(r)}" target="_blank" rel="noopener">افتح الفرع في قوقل ماب ↗</a></p>`
        : `<p class="branch warn">⚠️ ${[
              isVerified(r) ? null : (r.menu.length
                ? '<b>الأسعار تجريبية</b> — ما جُمعت من جاهز ولا هنقر ولا كيتا'
                : '<b>الأسعار ما انجمعت بعد</b> — ما فيه منيو لهذا المطعم'),
              hasRealRating(r) ? null : '<b>التقييم تجريبي</b> — ما جُمع من قوقل ماب'
            ].filter(Boolean).join('، و')}. الفرع: ${esc(r.branch)} —
            <a href="${mapsUrl(r)}" target="_blank" rel="noopener">افتحه في قوقل ماب ↗</a></p>`}
      <div class="kpis">
        <div class="kpi"><div class="n">★ ${r.rating}</div><div class="l">${hasRealRating(r) ? `${fmt(r.reviewsCount)} تقييم قوقل ماب` : 'تقييم تجريبي'}</div></div>
        <div class="kpi"><div class="n">${esc(r.eta)}</div><div class="l">وقت التوصيل</div></div>
        <div class="kpi"><div class="n">${esc(r.price)}</div><div class="l">مستوى السعر</div></div>
        <div class="kpi"><div class="n">${APP_KEYS.filter(k=>r.apps[k].on).length}</div><div class="l">تطبيقات متاحة</div></div>
      </div>
    </div>
  </section>

  <div class="tabs" role="tablist">
    <button class="tab" role="tab" aria-selected="${state.tab==='menu'}" data-act="tab" data-val="menu">قائمة الطعام</button>
    <button class="tab" role="tab" aria-selected="${state.tab==='cmp'}" data-act="tab" data-val="cmp">مقارنة التطبيقات</button>
    <button class="tab" role="tab" aria-selected="${state.tab==='rev'}" data-act="tab" data-val="rev">التقييمات والآراء</button>
  </div>

  <div class="panel">${
    state.tab==='menu' ? menuHTML(r,sel) :
    state.tab==='cmp'  ? cmpHTML(r,sel)  : revHTML(r)
  }</div>`;
}

function menuHTML(r,sel){
  if(!r.menu.length) return `<div class="empty">
    <div class="big">📋</div><h3>المنيو ما انجمع بعد</h3>
    <p>هذا المطعم أضيف من قوقل ماب، وأسعاره داخل التطبيقات لسه ما اتجمعت.
       التقييم والحي والفرع حقيقيين — المنيو هو الناقص.</p></div>`;
  return `
  <h2 class="sec-h">قائمة الطعام</h2>
  ${isVerified(r) ? '' : '<p class="databanner">⚠️ أسعار هذا المطعم <b>تجريبية</b> — ما جُمعت من التطبيقات. لا تبني عليها قرار طلب.</p>'}
  <p class="sec-p">كل صنف معروض بسعره داخل كل تطبيق. الخانة الخضراء هي الأرخص لهذا الصنف. حدّد الأصناف اللي تبي تطلبها وانتقل لتبويب المقارنة عشان تعرف أي تطبيق يطلع أوفر لطلبك أنت.</p>
  <div class="basketbar">
    <span>محدَّد <b>${sel.size}</b> من ${r.menu.length} صنف</span>
    <span>
      <button data-act="all">تحديد الكل</button> ·
      <button data-act="none">إلغاء الكل</button>
    </span>
  </div>
  ${r.menu.map((it,i)=>{
    const prices = APP_KEYS.map(k=>({k, v:itemPrice(r,it,k)}));
    const live = prices.filter(p=>p.v!==null);
    const min = live.length ? Math.min(...live.map(p=>p.v)) : null;
    return `<div class="mitem ${sel.has(i)?'picked':''}">
      <button class="mcheck" data-act="pick" data-i="${i}" aria-label="تحديد ${esc(it.n)}" aria-pressed="${sel.has(i)}">✓</button>
      <div class="minfo">
        <div class="n">${esc(it.n)}</div>
        ${it.d?`<div class="d">${esc(it.d)}</div>`:''}
      </div>
      <div class="mprices">
        ${prices.map(p=>`<div class="pp ${p.v===null?'na':(p.v===min?'low':'')}">
          <div class="a">${APPS[p.k].short}</div>
          <div class="v">${p.v===null?'—':fmt(p.v)}</div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('')}
  <p class="sec-p" style="margin-top:14px">الأسعار بالريال السعودي وتشمل زيادة التطبيق على سعر الفرع، ولا تشمل رسوم التوصيل.</p>`;
}

function cmpHTML(r,sel){
  if(!r.menu.length) return `<div class="empty">
    <div class="big">🧾</div><h3>ما فيه أسعار نقارنها</h3>
    <p>المقارنة تحتاج أسعار الأصناف داخل كل تطبيق، وهي ما انجمعت لهذا المطعم بعد.</p></div>`;
  const items = r.menu.filter((_,i)=>sel.has(i));
  if(!items.length){
    return `<div class="empty"><div class="big">🧾</div><h3>ما حددت أي صنف</h3>
      <p>ارجع لتبويب قائمة الطعام واختر الأصناف اللي تبي تطلبها.</p></div>`;
  }
  const c = compare(r, items);
  const b = c.best;
  return `
  ${isVerified(r) ? '' : '<p class="databanner">⚠️ هذي المقارنة مبنية على <b>أسعار تجريبية</b>، مو على أسعار حقيقية من التطبيقات — النتيجة تحت ما تعني شي لين تُجمع الأسعار الفعلية.</p>'}
  ${b ? `<div class="verdict">
    <div class="k">التوصية</div>
    <h3>اطلب من ${APPS[b.key].name}</h3>
    <p>لهذا الطلب (${items.length} صنف)، ${APPS[b.key].name} يطلع الأوفر بإجمالي <span class="save">${fmt(b.total)} ر.س</span> شامل التوصيل${c.saving>0?`، أي بتوفير <span class="save">${fmt(c.saving)} ر.س</span> مقارنة بأغلى تطبيق متاح.`:'.'}</p>
  </div>`:''}

  <div class="cmp">
    ${c.rows.map(row=>{
      if(!row.on) return `<div class="ccard na">
        <h4>${APPS[row.key].name}</h4>
        <p style="font-size:14px;color:var(--ink-soft)">المطعم غير متوفر على هذا التطبيق حالياً.</p>
      </div>`;
      const win = b && row.key===b.key;
      return `<div class="ccard ${win?'win':''}">
        ${win?'<span class="ribbon">الأوفر</span>':''}
        <h4>${APPS[row.key].name}</h4>
        <div class="line"><span>قيمة الأصناف</span><b>${fmt(row.sub)} ر.س</b></div>
        <div class="line"><span>رسوم التوصيل</span><b>${row.fee===0?'مجاني':fmt(row.fee)+' ر.س'}</b></div>
        <div class="total"><span class="t">الإجمالي</span><span class="v">${fmt(row.total)}</span></div>
        <div class="markup">زيادة عن سعر الفرع: ${Math.round((row.mult-1)*100)}%</div>
      </div>`;
    }).join('')}
  </div>

  <h2 class="sec-h">كيف تُحسب المقارنة؟</h2>
  <p class="sec-p">نأخذ سعر الصنف في الفرع ونضربه في نسبة الزيادة المسجّلة لكل تطبيق، نجمع الأصناف المحددة، ثم نضيف رسوم التوصيل. المقارنة لا تحسب كوبونات الخصم ولا اشتراكات التوصيل المجاني، وهذي غالباً تقلب النتيجة — فراجع العروض قبل ما تعتمد التوصية.</p>`;
}

function revHTML(r){
  const extra = state.extraReviews[r.id] || [];
  const all = [...extra, ...r.reviews];
  const dist = [5,4,3,2,1].map(s=>({s, n:all.filter(v=>v.r===s).length}));
  const max = Math.max(1,...dist.map(d=>d.n));
  return `
  <h2 class="sec-h">آراء الزوار</h2>
  ${hasRealRating(r)
    ? `<p class="sec-p">النجوم وعدد التقييمات مأخوذة من صفحة <b>${esc(r.branch)}</b> على قوقل ماب
        (<a href="${mapsUrl(r)}" target="_blank" rel="noopener">تحقّق منها هنا</a>).</p>`
    : `<p class="databanner">⚠️ النجوم وعدد التقييمات <b>أرقام تجريبية</b> — ما جُمعت من قوقل ماب.</p>`}
  ${!r.reviews.length ? '<p class="sec-p">ما فيه آراء مكتوبة لهذا المطعم — كن أول من يشارك تجربته.</p>' : ''}
  ${r.reviews.length ? `<p class="databanner">⚠️ الآراء المكتوبة تحت <b>نصوص توضيحية كتبها الذكاء الاصطناعي</b>؛
      أسماؤها وكلامها ما يعود لأشخاص حقيقيين.</p>` : ''}
  <div class="rev-top">
    <div class="score">
      <div class="n">${r.rating}</div>
      <div class="s">${'★'.repeat(Math.round(r.rating))}${'☆'.repeat(5-Math.round(r.rating))}</div>
      <div class="c">${fmt(r.reviewsCount)} تقييم</div>
    </div>
    <div class="bars">
      ${dist.map(d=>`<div class="brow">
        <span style="width:34px">${d.s} ★</span>
        <span class="btrack"><span class="bfill" style="width:${(d.n/max*100)||0}%"></span></span>
        <span style="width:22px;color:var(--ink-soft)">${d.n}</span>
      </div>`).join('')}
    </div>
  </div>

  ${all.map(v=>`<article class="review">
    <div class="rvh">
      <div class="rvwho">
        <span class="avatar">${esc(v.who.trim()[0]||'؟')}</span>
        <span><span class="nm">${esc(v.who)}</span><br><span class="dt">${esc(v.dt)}</span></span>
      </div>
      <span class="star">${'★'.repeat(v.r)}<span style="color:#DDD">${'★'.repeat(5-v.r)}</span></span>${v.dt==='الآن' ? '' : '<span class="sample">نموذج</span>'}
    </div>
    <p>${esc(v.t)}</p>
  </article>`).join('')}

  <div class="addbox">
    <h4>شارك تجربتك</h4>
    <div class="stars-pick" id="pick">
      ${[1,2,3,4,5].map(i=>`<button data-act="star" data-val="${i}" class="${state.newRating>=i?'on':''}" aria-label="${i} نجوم">★</button>`).join('')}
    </div>
    <input id="rv-name" placeholder="اسمك" maxlength="30">
    <textarea id="rv-text" rows="3" placeholder="كيف كانت التجربة؟ الطعم، السعر، وقت التوصيل…" maxlength="400"></textarea>
    <button class="submit" data-act="send">أضف التقييم</button>
  </div>`;
}

/* ==========================================================
   التفاعل
   ========================================================== */
function render(){
  window.scrollTo({top:0,behavior:'instant'});
  state.view==='list' ? renderList() : renderDetail();
}

document.addEventListener('click', e=>{
  const el = e.target.closest('[data-act]');
  if(!el) return;
  const act = el.dataset.act, val = el.dataset.val;

  if(act==='cuisine'){ state.cuisine=val; render(); }
  else if(act==='open'){ state.view='detail'; state.id=el.dataset.id; state.tab='menu'; state.newRating=0; render(); }
  else if(act==='back'){ state.view='list'; render(); }
  else if(act==='tab'){ state.tab=val; render(); }
  else if(act==='pick'){
    const s=basketSet(), i=+el.dataset.i;
    s.has(i)?s.delete(i):s.add(i); render();
  }
  else if(act==='all'){ state.basket[state.id]=new Set(getRest().menu.map((_,i)=>i)); render(); }
  else if(act==='none'){ state.basket[state.id]=new Set(); render(); }
  else if(act==='star'){ state.newRating=+val; render(); }
  else if(act==='send'){
    const nm=(document.getElementById('rv-name').value||'زائر').trim();
    const tx=(document.getElementById('rv-text').value||'').trim();
    if(!state.newRating){ alert('اختر عدد النجوم أولاً.'); return; }
    if(tx.length<5){ alert('اكتب رأيك في جملة على الأقل.'); return; }
    (state.extraReviews[state.id] ||= []).unshift({who:nm, r:state.newRating, dt:'الآن', t:tx});
    state.newRating=0; render();
  }
});

document.addEventListener('change', e=>{
  if(e.target.id==='sort'){ state.sort=e.target.value; render(); }
});

let t;
document.getElementById('q').addEventListener('input', e=>{
  clearTimeout(t);
  t=setTimeout(()=>{ state.q=e.target.value; state.view='list'; render(); },180);
});

render();
