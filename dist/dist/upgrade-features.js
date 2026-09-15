(function () {
  'use strict';
  const LS = { tg: 'admission_tg_v1', mem: 'admission_memorizing_v1', calc: 'admission_calc_v1', search: 'admission_search_v1', dict: 'admission_dict_v1' };
  const safeJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (_) { return fallback; } };
  const saveJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} };
  const escX = (v) => typeof esc === 'function' ? esc(String(v ?? '')) : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notify = (m) => typeof toast === 'function' ? toast(m) : window.alert(m);

  /* ================= CALCULATOR SYSTEM ================= */
  const CALC_TOOLS = [
    { id: 'percentage', name: 'Percentage', desc: 'Calculate % increase, decrease, discount', icon: '%', bg: '#e8f7ee', color: '#10b981' },
    { id: 'average', name: 'Average', desc: 'Find average of numbers', icon: '📊', bg: '#e0f2fe', color: '#0284c7' },
    { id: 'ratio', name: 'Ratio & Proportion', desc: 'Solve ratio and proportion', icon: '⚖️', bg: '#e0f2fe', color: '#0284c7' },
    { id: 'marks', name: 'Marks Calculator', desc: 'Calculate marks, grade, GPA', icon: '📋', bg: '#fff7ed', color: '#f97316' },
    { id: 'negative', name: 'Negative Marking', desc: 'Calculate score with negative marking', icon: '⊖', bg: '#fef2f2', color: '#ef4444' },
    { id: 'accuracy', name: 'MCQ Accuracy', desc: 'Calculate accuracy and performance', icon: '🎯', bg: '#e8f7ee', color: '#10b981' },
    { id: 'target', name: 'Target Calculator', desc: 'Plan your study target smartly', icon: '⭐', bg: '#e8f7ee', color: '#10b981' },
    { id: 'date', name: 'Date Difference', desc: 'Find days between two dates', icon: '📅', bg: '#eff6ff', color: '#3b82f6' },
    { id: 'studytime', name: 'Study Time Calc', desc: 'Track and calculate study time', icon: '⏱️', bg: '#eff6ff', color: '#3b82f6' }
  ];

  let CalcState = { 
    activeTool: null, 
    search: '',
    target: { mcq: 12000, days: 45, hours: 5 },
    recent: safeJson(LS.calc + '_recent', [
      { title: 'Target Plan: 12,000 MCQ in 45 Days', detail: 'Daily: 267 MCQ • 5 hours/day', time: 'Today, 9:30 AM', icon: '⭐' },
      { title: 'Percentage: 85 out of 100', detail: 'Percentage: 85.00%', time: 'Today, 8:15 AM', icon: '%' },
      { title: 'Negative Marking: 100 Qs', detail: 'Correct: 80 • Wrong: 15 • Score: 71.25', time: 'Yesterday, 11:45 PM', icon: '⊖' }
    ]),
    result: null
  };

  window.openCalcTool = function(id) {
    CalcState.activeTool = id;
    CalcState.result = null;
    renderCalculator();
  };

  window.closeCalcTool = function() {
    CalcState.activeTool = null;
    CalcState.result = null;
    renderCalculator();
  };

  window.runPlanner = function() {
    const mcq = parseFloat(document.getElementById('planMcq')?.value || 12000);
    const days = parseFloat(document.getElementById('planDays')?.value || 45);
    const hours = parseFloat(document.getElementById('planHours')?.value || 5);

    CalcState.target = { mcq, days, hours };
    const daily = Math.ceil(mcq / days);
    const weekly = daily * 7;
    const revDays = Math.floor(days * 0.2);
    
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + days);
    const dateStr = targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' (' + targetDate.toLocaleDateString('en-US', { weekday: 'long' }) + ')';

    CalcState.result = { daily, weekly, dateStr, revDays };
    
    // Add to recent
    CalcState.recent.unshift({
      title: `Target Plan: ${mcq.toLocaleString()} MCQ in ${days} Days`,
      detail: `Daily: ${daily} MCQ • ${hours} hours/day`,
      time: 'Just now',
      icon: '⭐'
    });
    if (CalcState.recent.length > 10) CalcState.recent.pop();
    saveJson(LS.calc + '_recent', CalcState.recent);

    renderCalculator();
  };

  window.runSpecificCalc = function() {
    const get = id => parseFloat(document.getElementById(id)?.value || 0);
    const getS = id => document.getElementById(id)?.value || '';
    const m = CalcState.activeTool;
    let res = '';

    if (m === 'percentage') {
      const v = get('c1'), t = get('c2');
      const pct = ((v/t)*100).toFixed(2);
      res = `Percentage: <b>${pct}%</b>`;
    } else if (m === 'average') {
      const vals = getS('c1').split(',').map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
      const avg = vals.reduce((a,b)=>a+b,0) / (vals.length || 1);
      res = `Average: <b>${avg.toFixed(2)}</b>`;
    } else if (m === 'ratio') {
      const a = get('c1'), b = get('c2');
      const gcd = (x,y) => y ? gcd(y, x%y) : x;
      const common = gcd(a, b) || 1;
      res = `Ratio: <b>${a/common} : ${b/common}</b>`;
    } else if (m === 'marks') {
      const o = get('c1'), t = get('c2');
      const pct = (o/t)*100;
      let g = 'F'; if(pct>=80)g='A+';else if(pct>=70)g='A';else if(pct>=60)g='A-';else if(pct>=50)g='B';else if(pct>=40)g='C';else if(pct>=33)g='D';
      res = `Percentage: <b>${pct.toFixed(2)}%</b><br>Grade: <b>${g}</b>`;
    } else if (m === 'negative') {
      const q = get('c1'), c = get('c2'), w = get('c3'), mc = 1, mw = 0.25;
      const net = (c * mc) - (w * mw);
      res = `Net Score: <b>${net.toFixed(2)}</b> out of ${q}`;
    } else if (m === 'accuracy') {
      const a = get('c1'), c = get('c2');
      res = `Accuracy: <b>${((c/a)*100).toFixed(2)}%</b>`;
    } else if (m === 'target') {
      const q = get('c1'), d = get('c2');
      res = `Daily Target: <b>${Math.ceil(q/d)} Qs/day</b>`;
    } else if (m === 'date') {
      const d1 = new Date(getS('c1')), d2 = new Date(getS('c2'));
      const diff = Math.abs(d2 - d1) / (1000 * 60 * 60 * 24);
      res = `Difference: <b>${Math.floor(diff)} Days</b>`;
    } else if (m === 'studytime') {
      const topics = get('c1'), per = get('c2');
      const total = topics * per;
      res = `Total Time: <b>${Math.floor(total/60)} Hours ${total%60} Mins</b>`;
    }

    const outputEl = document.getElementById('calcOutput');
    if (outputEl) outputEl.innerHTML = res;
  };

  function renderCalculator() {
    const tool = CALC_TOOLS.find(x => x.id === CalcState.activeTool);
    const search = (CalcState.search || '').toLowerCase();
    const filteredTools = CALC_TOOLS.filter(x => !search || x.name.toLowerCase().includes(search) || x.desc.toLowerCase().includes(search));

    const defaultDaily = Math.ceil(CalcState.target.mcq / CalcState.target.days);
    const defaultWeekly = defaultDaily * 7;
    const defaultRev = Math.floor(CalcState.target.days * 0.2);
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + CalcState.target.days);
    const dateStr = targetDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const dayStr = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

    const res = CalcState.result || { daily: defaultDaily, weekly: defaultWeekly, dateStr: `${dateStr} ${dayStr}`, revDays: defaultRev };

    if (tool) {
      // Render individual tool modal/view
      let fields = '';
      if (tool.id === 'percentage') fields = `<label class="flabel">Value (obtained)</label><input id="c1" type="number" placeholder="e.g. 85"><label class="flabel">Total</label><input id="c2" type="number" placeholder="e.g. 100">`;
      else if (tool.id === 'average') fields = `<label class="flabel">Numbers (comma separated)</label><input id="c1" type="text" placeholder="10, 20, 30, 40">`;
      else if (tool.id === 'ratio') fields = `<label class="flabel">First Number</label><input id="c1" type="number" placeholder="e.g. 50"><label class="flabel">Second Number</label><input id="c2" type="number" placeholder="e.g. 150">`;
      else if (tool.id === 'marks') fields = `<label class="flabel">Marks Obtained</label><input id="c1" type="number" placeholder="e.g. 75"><label class="flabel">Total Marks</label><input id="c2" type="number" placeholder="e.g. 100">`;
      else if (tool.id === 'negative') fields = `<label class="flabel">Total Questions</label><input id="c1" type="number" placeholder="100"><label class="flabel">Correct Answers</label><input id="c2" type="number" placeholder="80"><label class="flabel">Wrong Answers</label><input id="c3" type="number" placeholder="15">`;
      else if (tool.id === 'accuracy') fields = `<label class="flabel">Total Attempted</label><input id="c1" type="number" placeholder="50"><label class="flabel">Correct Answers</label><input id="c2" type="number" placeholder="42">`;
      else if (tool.id === 'target') fields = `<label class="flabel">Total MCQ</label><input id="c1" type="number" placeholder="12000"><label class="flabel">Total Days</label><input id="c2" type="number" placeholder="45">`;
      else if (tool.id === 'date') fields = `<label class="flabel">Start Date</label><input id="c1" type="date"><label class="flabel">End Date</label><input id="c2" type="date">`;
      else if (tool.id === 'studytime') fields = `<label class="flabel">Total Topics</label><input id="c1" type="number" placeholder="30"><label class="flabel">Time per Topic (minutes)</label><input id="c2" type="number" placeholder="45">`;

      shell(`
        <div class="calc-sub-header">
          <button class="calc-back-btn" onclick="closeCalcTool()">‹</button>
          <div>
            <h1>${tool.name}</h1>
            <p>${tool.desc}</p>
          </div>
        </div>
        <div class="card" style="margin-top:16px;">
          ${fields}
          <button class="btn" style="margin-top:16px;width:100%" onclick="runSpecificCalc()">Calculate</button>
          <div id="calcOutput" class="calc-output-box" style="margin-top:16px;font-size:18px;text-align:center;"></div>
        </div>
      `, { title: tool.name, back: "closeCalcTool()" });
      return;
    }

    shell(`
      <div class="calc-header-v3">
        <div>
          <h1>Advanced Study Calculator</h1>
          <p>Smart calculation for your study journey</p>
        </div>
        <div class="calc-header-icons">
          <button class="calc-icon-btn">⏱</button>
          <button class="calc-icon-btn">★</button>
        </div>
      </div>

      <div class="calc-search-box">
        <span>🔍</span>
        <input type="text" placeholder="Search calculator tools..." value="${escX(CalcState.search)}" oninput="CalcState.search=this.value;renderCalculator()">
      </div>

      <div class="section-row">
        <h3>Quick Calculators</h3>
        <a href="#" onclick="return false;">View All ›</a>
      </div>

      <div class="calc-grid-v3">
        ${filteredTools.map(t => `
          <div class="calc-tile" onclick="openCalcTool('${t.id}')">
            <div class="calc-tile-icon" style="background:${t.bg};color:${t.color}">${t.icon}</div>
            <div class="calc-tile-info">
              <b>${t.name}</b>
              <small>${t.desc}</small>
            </div>
            <span class="calc-tile-arrow">›</span>
          </div>
        `).join('')}
      </div>

      <div class="planner-card card">
        <div class="planner-header">
          <div class="planner-icon">⭐</div>
          <div>
            <h3>Study Target Planner</h3>
            <p>Plan your preparation and reach your goal</p>
          </div>
        </div>
        
        <div class="planner-inputs">
          <div class="planner-input-group">
            <label>Total MCQ</label>
            <input id="planMcq" type="number" value="${CalcState.target.mcq}">
          </div>
          <div class="planner-input-group">
            <label>Total Days</label>
            <input id="planDays" type="number" value="${CalcState.target.days}">
          </div>
          <div class="planner-input-group">
            <label>Daily Study Time</label>
            <input id="planHours" type="number" value="${CalcState.target.hours}">
          </div>
        </div>

        <button class="btn planner-btn" onclick="runPlanner()">
          <span>📊</span> Calculate My Plan
        </button>

        <div class="planner-results">
          <div class="planner-res-box">
            <div class="res-title">🎯 Daily Target</div>
            <div class="res-val">${res.daily}</div>
            <div class="res-sub">MCQ</div>
          </div>
          <div class="planner-res-box">
            <div class="res-title">📅 Weekly Target</div>
            <div class="res-val">${res.weekly}</div>
            <div class="res-sub">MCQ</div>
          </div>
          <div class="planner-res-box">
            <div class="res-title">🚩 Target Date</div>
            <div class="res-val" style="font-size:15px;font-weight:700;">${res.dateStr.split(' ')[0]} ${res.dateStr.split(' ')[1]} ${res.dateStr.split(' ')[2]}</div>
            <div class="res-sub">${res.dateStr.split(' ').slice(3).join(' ')}</div>
          </div>
          <div class="planner-res-box">
            <div class="res-title">📖 Revision Days</div>
            <div class="res-val">${res.revDays}</div>
            <div class="res-sub">Days</div>
          </div>
        </div>
      </div>

      <div class="section-row" style="margin-top:24px;">
        <h3>Recent Calculations</h3>
        <a href="#" onclick="return false;">View All ›</a>
      </div>

      <div class="recent-list">
        ${CalcState.recent.map(r => `
          <div class="recent-item card">
            <div class="recent-icon">${r.icon}</div>
            <div class="recent-content">
              <b>${r.title}</b>
              <p>${r.detail}</p>
            </div>
            <div class="recent-meta">
              <span>${r.time}</span>
              <span>›</span>
            </div>
          </div>
        `).join('')}
      </div>
    `, { title: 'Study Calculator', back: "navigate('dashboard')" });
  }

  function addStyles(){ 
    if (document.getElementById('admission-upgrade-styles')) return; 
    const s=document.createElement('style'); 
    s.id='admission-upgrade-styles'; 
    s.textContent=`
      .calc-header-v3{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;}
      .calc-header-v3 h1{font-size:24px;font-weight:800;margin:0;color:var(--text);}
      .calc-header-v3 p{font-size:13px;color:var(--sub);margin:2px 0 0;}
      .calc-header-icons{display:flex;gap:8px;}
      .calc-icon-btn{width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:#fff;display:grid;place-items:center;cursor:pointer;font-size:16px;}
      
      .calc-search-box{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px 14px;margin-bottom:20px;box-shadow:var(--shadow);}
      .calc-search-box input{width:100%;border:0;outline:0;background:transparent;font-size:15px;}
      
      .section-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
      .section-row h3{font-size:17px;font-weight:700;margin:0;color:var(--text);}
      .section-row a{font-size:13px;color:var(--emerald);text-decoration:none;font-weight:600;}
      
      .calc-grid-v3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px;}
      @media(max-width:600px){.calc-grid-v3{grid-template-columns:repeat(1,1fr);}}
      .calc-tile{background:#fff;border:1px solid var(--line);border-radius:16px;padding:12px;display:flex;align-items:center;gap:10px;cursor:pointer;box-shadow:var(--shadow);transition:transform 0.1s;}
      .calc-tile:active{transform:scale(0.98);}
      .calc-tile-icon{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;font-size:18px;font-weight:700;flex-shrink:0;}
      .calc-tile-info{flex:1;min-width:0;}
      .calc-tile-info b{display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .calc-tile-info small{display:block;font-size:10px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .calc-tile-arrow{color:var(--sub);font-size:16px;}
      
      .planner-card{padding:20px;background:#fff;border-radius:20px;border:1px solid var(--line);box-shadow:var(--shadow);}
      .planner-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;}
      .planner-icon{width:40px;height:40px;border-radius:12px;background:#e8f7ee;color:var(--emerald);display:grid;place-items:center;font-size:20px;}
      .planner-header h3{font-size:17px;font-weight:800;margin:0;color:var(--text);}
      .planner-header p{font-size:12px;color:var(--sub);margin:2px 0 0;}
      
      .planner-inputs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;}
      @media(max-width:600px){.planner-inputs{grid-template-columns:1fr;}}
      .planner-input-group label{display:block;font-size:11px;font-weight:700;color:var(--sub);margin-bottom:6px;}
      .planner-input-group input{width:100%;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:#fcfcfc;font-size:15px;font-weight:700;color:var(--text);}
      
      .planner-btn{width:100%;height:48px;background:var(--emerald);color:#fff;border-radius:14px;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;border:0;cursor:pointer;margin-bottom:20px;}
      
      .planner-results{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
      @media(max-width:600px){.planner-results{grid-template-columns:repeat(2,1fr);}}
      .planner-res-box{background:#f8fafc;border:1px solid var(--line);border-radius:14px;padding:12px 8px;text-align:center;}
      .res-title{font-size:11px;color:var(--sub);margin-bottom:4px;font-weight:600;}
      .res-val{font-size:18px;font-weight:800;color:var(--emerald);}
      .res-sub{font-size:10px;color:var(--sub);margin-top:2px;}
      
      .recent-list{display:flex;flex-direction:column;gap:10px;}
      .recent-item{display:flex;align-items:center;gap:12px;padding:14px;background:#fff;border-radius:14px;border:1px solid var(--line);box-shadow:var(--shadow);}
      .recent-icon{width:36px;height:36px;border-radius:10px;background:#e8f7ee;color:var(--emerald);display:grid;place-items:center;font-size:16px;}
      .recent-content{flex:1;}
      .recent-content b{display:block;font-size:14px;color:var(--text);}
      .recent-content p{margin:2px 0 0;font-size:12px;color:var(--sub);}
      .recent-meta{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--sub);}
      
      .calc-sub-header{display:flex;align-items:center;gap:12px;}
      .calc-back-btn{width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:#fff;font-size:20px;cursor:pointer;display:grid;place-items:center;}
      .calc-sub-header h1{font-size:22px;font-weight:800;margin:0;}
      .calc-sub-header p{margin:2px 0 0;font-size:12px;color:var(--sub);}
      .calc-output-box{padding:16px;background:#f0fdf4;border-radius:12px;border:1px solid #10b981;color:#065f46;font-weight:700;}
    `; 
    document.head.appendChild(s); 
  }

  window.renderCalculator = renderCalculator;

  const oldRender=window.render; 
  window.render=function(){
    const p=(typeof Router!=='undefined'?Router.path:location.hash.slice(1))||'dashboard';
    if(p==='calculator') return renderCalculator();
    return oldRender();
  };
})();
