(function(){
  const RATINGS = ["Extremely unlikely","Very unlikely","Unlikely","Likely","Very likely","Extremely likely"];
  const RATING_BANDS = ["0\u201317%","17\u201333%","33\u201350%","50\u201367%","67\u201383%","83\u2013100%"];
  const FREQ_OPTIONS = ["Never","Less than weekly","1\u20132 days/week","3\u20134 days/week","5\u20136 days/week","Daily"];

  const state = {
    step: 0,
    participantId: "P-" + Math.floor(1000+Math.random()*9000),

    rows: [],
    csvName: "",
    csvError: "",
    idx: 0,
    ratings: {},        // prompt_id -> {rating, rt_ms}
    itemStart: null,
    attention: "",
    reflection: "",
    demo: { gender:"", age:"", education:"", occupation:"", freq2:"" },
    consentChecked: false
  };

  // Progress survives a refresh or a closed tab: the whole state is mirrored to
  // localStorage on every render. "Start over" is the only way to discard it,
  // so a lab machine shared between participants needs that click in between.
  const STORE_KEY = "larp.session.v1";
  const UNSENT_KEY = "larp.unsent.v1";
  function save(){
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch(e){ /* quota/private mode: run without persistence */ }
  }
  function restore(){
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if(!raw) return false;
      const saved = JSON.parse(raw);
      if(!saved || typeof saved.step !== "number") return false;
      Object.assign(state, saved);
      state.itemStart = Date.now();
      return true;
    } catch(e){ return false; }
  }
  function startOver(){
    if(!confirm("Discard this session and start from the beginning?")) return;
    try { localStorage.removeItem(STORE_KEY); } catch(e){}
    location.reload();
  }

  const STEPS = [
    "Consent","Upload prompts","Background","Satisfactory answer",
    "Rating scale","Rating task","Post-task","Demographics","Done"
  ];



  // Papa Parse handles quoted fields with embedded newlines/commas — the
  // hand-rolled splitter silently dropped any prompt containing a line break.
  function parseCSV(text){
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: "greedy",
      transformHeader: h => h.trim().toLowerCase() });
    const fatal = parsed.errors.filter(e => e.type !== "FieldMismatch");
    if(fatal.length) return {rows:[], error: fatal[0].message};
    const header = parsed.meta.fields || [];
    const required = ["prompt_id","category","which_of_the_following","prompt_text"];
    for(const r of required){
      if(!header.includes(r)) return {rows:[], error:"Missing column: " + r};
    }
    const rows = parsed.data
      .map(obj => { const o = {}; for(const k in obj) o[k] = String(obj[k] ?? "").trim(); return o; })
      .filter(o => o.prompt_id && o.prompt_text);
    if(!rows.length) return {rows:[], error:"File is empty."};
    const ids = new Set(rows.map(r => r.prompt_id));
    if(ids.size !== rows.length) return {rows:[], error:"Duplicate prompt_id values in file."};
    return {rows, error:null};
  }

  function csvEscape(v){
    v = String(v ?? "");
    if(/[",\n]/.test(v)) return '"' + v.replace(/"/g,'""') + '"';
    return v;
  }

  function buildOutputCSV(){
    const headers = [
      "participant_id","prompt_id","category","which_of_the_following","prompt_text",
      "rating","rating_level","response_time_ms",
      "attention_check","reflection",
      "gender","age","education","occupation","genai_freq_post"
    ];
    const lines = [headers.join(",")];
    state.rows.forEach(r => {
      const rt = state.ratings[r.prompt_id] || {rating:"", level:"", ms:""};
      const line = [
        state.participantId, r.prompt_id, r.category, r.which_of_the_following, r.prompt_text,
        rt.rating, (rt.level ?? ""), rt.ms,
        state.attention, state.reflection,
        state.demo.gender, state.demo.age, state.demo.education, state.demo.occupation, state.demo.freq2
      ].map(csvEscape).join(",");
      lines.push(line);
    });
    return lines.join("\n");
  }

  function heroSVG(){
    return `<svg class="larp-hero-diagram" viewBox="0 0 600 100" width="100%" height="100" xmlns="http://www.w3.org/2000/svg">
      <text x="20" y="30" font-family="var(--mono)" font-size="11" fill="var(--muted)">PROMPT</text>
      <rect x="16" y="38" width="90" height="26" rx="5" fill="#fff" stroke="var(--line)"/>
      <line x1="106" y1="51" x2="230" y2="51" stroke="var(--line)" stroke-width="1.5"/>
      <circle cx="245" cy="51" r="16" fill="var(--cloud-soft)" stroke="var(--cloud)"/>
      <text x="245" y="55" font-family="var(--mono)" font-size="9" fill="var(--cloud)" text-anchor="middle">You</text>
      <line x1="261" y1="44" x2="360" y2="22" stroke="var(--local)" stroke-width="1.5"/>
      <line x1="261" y1="58" x2="360" y2="80" stroke="var(--cloud)" stroke-width="1.5"/>
      <rect x="364" y="8" width="120" height="26" rx="5" fill="var(--local-soft)" stroke="var(--local)"/>
      <text x="424" y="25" font-family="var(--mono)" font-size="10" fill="var(--local)" text-anchor="middle">LOCAL MODEL</text>
      <rect x="364" y="66" width="120" height="26" rx="5" fill="var(--cloud-soft)" stroke="var(--cloud)"/>
      <text x="424" y="83" font-family="var(--mono)" font-size="10" fill="var(--cloud)" text-anchor="middle">CLOUD MODEL</text>
    </svg>`;
  }

  function render(){
    const root = document.getElementById("larp-root").querySelector(".larp-shell") ||
      (function(){ const d=document.createElement("div"); d.className="larp-shell"; document.getElementById("larp-root").appendChild(d); return d; })();

    root.innerHTML = `
      <div class="larp-header">
        <div>
          <div class="larp-eyebrow">LARP \u2014 Study Platform</div>
          <h1 class="larp-title">Can a Local Model Solve this?</h1>
        </div>
        <div class="larp-pid">Participant ID: ${state.participantId}
          ${state.step > 0 ? '<button class="larp-btn ghost small" id="larp-start-over" type="button">Start over</button>' : ''}</div>
      </div>
      <div class="larp-layout">
        <div class="larp-stepper">
          ${STEPS.map((s,i) => `<div class="larp-step-node ${i<state.step?'done':''} ${i===state.step?'active':''}">${s}</div>`).join("")}
        </div>
        <div class="larp-panel" id="larp-panel"></div>
      </div>
    `;
    const so = root.querySelector("#larp-start-over");
    if(so) so.onclick = startOver;
    renderPanel();
  }

  function renderPanel(){
    save();
    const p = document.getElementById("larp-panel");
    p.innerHTML = "";
    const body = document.createElement("div");
    body.className = "larp-body";
    const foot = document.createElement("div");
    foot.className = "larp-foot";

    if(state.step === 0) stepConsent(p, body, foot);
    else if(state.step === 1) stepUpload(p, body, foot);
    else if(state.step === 2) stepBackground(p, body, foot);
    else if(state.step === 3) stepSatisfactory(p, body, foot);
    else if(state.step === 4) stepScale(p, body, foot);
    else if(state.step === 5) stepRating(p, body, foot);
    else if(state.step === 6) stepPostTask(p, body, foot);
    else if(state.step === 7) stepDemographics(p, body, foot);
    else stepDone(p, body, foot);
  }

  function heading(p, title, sub){
    const h = document.createElement("h2"); h.textContent = title; p.appendChild(h);
    if(sub){ const s = document.createElement("p"); s.className="larp-sub"; s.textContent = sub; p.appendChild(s); }
  }

  function navBtn(label, onClick, opts={}){
    const b = document.createElement("button");
    b.className = "larp-btn" + (opts.ghost ? " ghost" : "") + (opts.small ? " small" : "");
    b.textContent = label;
    b.disabled = !!opts.disabled;
    b.onclick = onClick;
    return b;
  }

  // Six-point probability-band scale, three-below / three-above with the 50% boundary.
  // opts.interactive -> renders buttons; opts.selected (0-5) marks the chosen band;
  // opts.onSelect(level) is called on click.
  function buildBandGrid(opts){
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.className = "larp-band-grid";
    const rowTop = document.createElement("div"); rowTop.className = "larp-band-row";
    const rowBot = document.createElement("div"); rowBot.className = "larp-band-row";
    RATINGS.forEach((label, level) => {
      const cell = document.createElement(opts.interactive ? "button" : "div");
      cell.className = "larp-band" + (opts.selected === level ? " sel" : "");
      cell.innerHTML = `<div class="lab">${label}</div><div class="pct">${RATING_BANDS[level]}</div>`;
      if(opts.interactive) cell.onclick = () => opts.onSelect(level);
      (level < 3 ? rowTop : rowBot).appendChild(cell);
    });
    const divider = document.createElement("div");
    divider.className = "larp-band-divider";
    divider.textContent = "50%";
    wrap.appendChild(rowTop);
    wrap.appendChild(divider);
    wrap.appendChild(rowBot);
    return wrap;
  }

  function stepConsent(p, body, foot){
    heading(p, "Before you begin");
    body.innerHTML = `
      <p class="larp-lead">You are invited to take part in a study about how people judge what small AI models can do. Participation is voluntary and you may stop at any time without giving a reason.</p>
      <div class="larp-summary-cols">
        <div><div class="k">What you'll do</div><div class="v">Rate ${state.rows.length || 28} short prompts</div></div>
        <div><div class="k">How long</div><div class="v">About 15 minutes</div></div>
        <div><div class="k">Data collected</div><div class="v">Ratings, timing, demographics</div></div>
      </div>
      <p class="larp-note">Responses are stored without identifying information and reported only in aggregate. You will not be asked to answer the prompts yourself, and there are no right or wrong responses.</p>
      <div class="larp-consent-box">
        <p>You are invited to participate in the online study which investigates knowledge about local model capabilities. The study is conducted by Noah Meissner, Samuel Bullard, Federico Mizzaro and supervised by Dr. David Elsweiler from the University of Regensburg. The study with estimated 30 participants will take place in the period from 2026-08-01 to 2026-08-15. Please note:</p>
        <ul>
          <li>Your participation is entirely voluntary and can be discontinued or withdrawn at any time</li>
          <li>For the evaluation, we collect some basic demographic personal information (e.g., age, gender, etc.)</li>
          <li>The study will last ca. 15 minutes</li>
          <li>You have no direct benefit from participating in the study (unless you receive 0.5 VP hours as a student of the University of Regensburg), but you support our work and help to advance research in this area.</li>
          <li>During the course of the session, all responses entered into the system will be meticulously documented, inclusive of timestamp data.</li>
          <li>Recordings and personal data are treated with confidentiality and will be fully anonymized, stored, evaluated, and potentially published so that no conclusions can be drawn about individual persons anymore</li>
        </ul>
        <p>The option to decline participation is available. For any inquiries, concerns, or complaints regarding the informed consent process or your rights as a research subject, please contact Dr. David Elsweiler. Please read the following information carefully and take the time you need.</p>

        <h3>Purpose and Goal of this Research</h3>
        <p>The purpose of this study is to understand how well people can predict whether a small AI language model that runs locally on everyday devices is able to answer a given question satisfactorily. The goal is to learn whether human judgment is a reliable basis for deciding when a request can be handled by a small local model rather than a larger cloud-based one, which will help inform the design of more efficient and privacy-friendly AI systems.</p>

        <h3>Study Participation</h3>
        <p>Your participation in this online study is entirely voluntary and can be discontinued or withdrawn at any time. You can refuse to answer any questions or continue with the study at any time if you feel uncomfortable in any way. You can discontinue or withdraw your participation at any time without giving a reason. However, we reserve the right to exclude you from the study (e.g., with invalid trials or if continuing the study could have a negative impact on your well-being or the equipment). Repeated participation in the study is not permitted.</p>

        <h3>Study Procedure</h3>
        <ol>
          <li>Participants are initially provided with a brief introduction to the study. After this they will complete the informed consent process.</li>
          <li>This follows by a brief, neutral explanation of local vs. cloud models and of the rating task.</li>
          <li>Participants are assigned to label a stratified sample of open-ended prompts.</li>
          <li>At the end the participants answer demographic questions.</li>
        </ol>
        <p>The confirmation of participation in this study can be obtained directly from the researchers.</p>

        <h3>Risks and Benefits</h3>
        <p>In the online study you will not be exposed to any immediate risk or danger. As with all computer systems on which data is processed, despite security measures, there is a small risk of data leakage and the loss of confidential or personal information. You have no direct benefit from participating in the study (unless you receive 0.5 VP hours as a student of the University of Regensburg), but you support our work and help to advance research in this area.</p>

        <h3>Data Protection and Confidentiality</h3>
        <p>In this study, personal and personally identifiable information is collected for our research. The use of personal or personally identifiable data is subject to the General Data Protection Regulation (GDPR) of the European Union (EU) and will be handled in accordance with the GDPR. This means that you can view, correct, restrict the processing of and have deleted the data collected in this study. Your entries will only be registered in the study with your consent. We plan to publish the results of this and other research studies in scientific articles or other media. Your data will be retained until the study is completed or you contact the researchers to have your data destroyed or deleted. Access to the raw data of the study will be encrypted, password protected during the analysis and only for the authors, colleagues and researchers collaborating on this research. As part of the research work, the data is anonymised using coded identification numbers, whereby no conclusions can be drawn about individual persons without the researchers' information. As no contact details (e.g. emails) are collected, the researchers cannot inform the participants about further details of the study or about a possible breach of confidential data.</p>

        <h3>Identification of Investigators</h3>
        <p><strong>Researchers</strong></p>
        <ul>
          <li>Noah Mei&szlig;ner (<a href="mailto:noah.meissner@stud.uni-regensburg.de">noah.meissner@stud.uni-regensburg.de</a>)</li>
          <li>Samuel Bullard (<a href="mailto:Samuel.Bullard@stud.uni-regensburg.de">Samuel.Bullard@stud.uni-regensburg.de</a>)</li>
          <li>Federico Mizzaro (<a href="mailto:federico.mizzaro@stud.uni-regensburg.de">federico.mizzaro@stud.uni-regensburg.de</a>)</li>
        </ul>
        <p><strong>Principal Investigator</strong></p>
        <p>Dr. David Elsweiler<br>
        <a href="mailto:David.Elsweiler@sprachlit.uni-regensburg.de">David.Elsweiler@sprachlit.uni-regensburg.de</a><br>
        University of Regensburg<br>
        Universit&auml;tsstr. 31<br>
        93053 Regensburg, Germany</p>
      </div>
      <div class="larp-check-row">
        <input type="checkbox" id="larp-consent-cb" ${state.consentChecked?"checked":""}/>
        <label for="larp-consent-cb">I have read the information above and agree to participate.</label>
      </div>
    `;
    p.appendChild(body);
    p.appendChild(foot);
    foot.appendChild(document.createElement("span"));
    const next = navBtn("Continue", () => { state.step = 1; render(); }, {disabled: !state.consentChecked});
    foot.appendChild(next);
    body.querySelector("#larp-consent-cb").onchange = (e) => {
      state.consentChecked = e.target.checked;
      next.disabled = !state.consentChecked;
    };
  }

  function stepUpload(p, body, foot){
    heading(p, "Upload your prompt file", "You should have received a CSV with 28 prompts from the study team.");
    body.innerHTML = `
      <div class="larp-dropzone" id="larp-drop">
        <div>Drag a CSV file here or click to choose one</div>
        <input type="file" accept=".csv" id="larp-file-input" style="display:none;"/>
      </div>
      <div id="larp-file-status"></div>

    `;
    p.appendChild(body);
    p.appendChild(foot);
    const back = navBtn("Back", () => { state.step = 0; render(); }, {ghost:true});
    const next = navBtn("Continue", () => { state.idx = 0; state.step = 2; render(); }, {disabled: state.rows.length === 0});
    foot.appendChild(back); foot.appendChild(next);

    const drop = body.querySelector("#larp-drop");
    const input = body.querySelector("#larp-file-input");
    const status = body.querySelector("#larp-file-status");

    function showStatus(){
      if(state.csvError){
        status.innerHTML = `<div class="larp-file-err">Error reading file (${state.csvName}): ${state.csvError}</div>`;
      } else if(state.rows.length){
        status.innerHTML = `<div class="larp-file-ok">${state.csvName}: ${state.rows.length} prompts detected.</div>`;
      } else {
        status.innerHTML = "";
      }
      next.disabled = state.rows.length === 0;
    }

    function handleFile(file){
      state.csvName = file.name;
      const reader = new FileReader();
      reader.onload = (e) => {
        const {rows, error} = parseCSV(e.target.result);
        state.rows = rows; state.csvError = error;
        if(rows.length && rows[0].participant_id) state.participantId = rows[0].participant_id;
        showStatus();
      };
      reader.readAsText(file);
    }

    drop.onclick = () => input.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("drag"); };
    drop.ondragleave = () => drop.classList.remove("drag");
    drop.ondrop = (e) => {
      e.preventDefault(); drop.classList.remove("drag");
      if(e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    };
    input.onchange = (e) => { if(e.target.files.length) handleFile(e.target.files[0]); };

    showStatus();
  }

  // Screen 2 of 4 - background
  function stepBackground(p, body, foot){
    heading(p, "Two places an AI model can run");
    body.innerHTML = `
      <div class="larp-two-box">
        <div class="larp-mode-box local">
          <div class="h"><span class="larp-dot local"></span>On your device</div>
          <div class="d">A smaller model runs locally. Nothing leaves your machine, and it uses less energy.</div>
        </div>
        <div class="larp-mode-box cloud">
          <div class="h"><span class="larp-dot cloud"></span>In the cloud</div>
          <div class="d">A larger model runs on remote servers. Your request is sent over the internet.</div>
        </div>
      </div>
      <p class="larp-lead">Both kinds of model answer the same sorts of questions. Which one suits a given request depends on the request.</p>
      <p class="larp-lead">In this study you will see prompts one at a time and estimate how likely a specific local model, <strong>Gemma4&ndash;e2b</strong>, is to answer each one satisfactorily. You will not answer the prompts, and you will not see the model&rsquo;s answers.</p>
    `;
    p.appendChild(body);
    p.appendChild(foot);
    const back = navBtn("Back", () => { state.step = 1; render(); }, {ghost:true});
    const next = navBtn("Continue", () => { state.step = 3; render(); });
    foot.appendChild(back); foot.appendChild(next);
  }

  // Screen 3 of 4 - what counts as satisfactory
  function stepSatisfactory(p, body, foot){
    heading(p, "What counts as a satisfactory answer");
    body.innerHTML = `
      <p class="larp-lead">Every prompt in this study has a known correct answer. An answer is <strong>satisfactory</strong> if it gives that answer.</p>
      <p class="larp-lead">Think of it as a panel of experts deciding by majority, each with the correct answer in front of them, asked only one thing: does the model&rsquo;s response say the same thing?</p>
      <p class="larp-note">Wording, length, and style are not part of the judgement. Two answers that say the same thing in different words are both satisfactory. A well&ndash;written answer that says something else is not.</p>
      <div class="larp-example">
        <div class="head"><span class="lbl">Correct answer</span><span class="ans">4.0 L</span></div>
        <div class="larp-ex-row"><span class="larp-mark ok">&#10003;</span><span>The volume doubles, so 4.0 L.</span></div>
        <div class="larp-ex-row"><span class="larp-mark ok">&#10003;</span><span>Four litres.</span></div>
        <div class="larp-ex-row"><span class="larp-mark no">&#10007;</span><span>This follows from the gas laws, which relate volume and temperature.</span></div>
      </div>
      <p class="larp-note">You will not see the correct answers during the task, and you are not expected to work them out yourself.</p>
    `;
    p.appendChild(body);
    p.appendChild(foot);
    const back = navBtn("Back", () => { state.step = 2; render(); }, {ghost:true});
    const next = navBtn("Continue", () => { state.step = 4; render(); });
    foot.appendChild(back); foot.appendChild(next);
  }

  // Screen 4 of 4 - the rating scale
  function stepScale(p, body, foot){
    heading(p, "The rating scale");
    body.innerHTML = `
      <p class="larp-lead">Your rating estimates how often the local model would answer a given prompt correctly, if it were asked the same prompt repeatedly.</p>
      <p class="larp-note">The six options divide that proportion into equal ranges covering every possibility, three below an even chance and three above.</p>
    `;
    body.appendChild(buildBandGrid());

    const instinct = document.createElement("div");
    instinct.className = "larp-instinct";
    instinct.textContent = "Answer on instinct. Many prompts are specialist questions from fields you may not know, and you are not expected to work them out. Judging the prompt without knowing the answer is the task.";
    body.appendChild(instinct);

    const expect = document.createElement("div");
    expect.innerHTML = `
      <div class="larp-field">A few things to expect</div>
      <ul class="larp-expect">
        <li>You cannot return to a previous prompt once you&rsquo;ve moved on.</li>
        <li>Every prompt needs a rating &mdash; there is no skip or &ldquo;don&rsquo;t know&rdquo; option.</li>
        <li>You will not see the model&rsquo;s answers or be told whether your ratings were accurate.</li>
        <li>One item asks you to select a specific option instead of giving a rating. It checks that instructions are being read.</li>
      </ul>
    `;
    body.appendChild(expect);

    p.appendChild(body);
    p.appendChild(foot);
    const back = navBtn("Back", () => { state.step = 3; render(); }, {ghost:true});
    const next = navBtn("Start rating", () => { state.idx = 0; state.itemStart = Date.now(); state.step = 5; render(); });
    foot.appendChild(back); foot.appendChild(next);
  }

  function stepRating(p, body, foot){
    const total = state.rows.length;
    const row = state.rows[state.idx];
    heading(p, `Prompt ${state.idx+1} of ${total}`);
    const track = document.createElement("div");
    track.className = "larp-progress-track";
    for(let i=0;i<total;i++){
      const t = document.createElement("div");
      t.className = "larp-tick" + (i < state.idx ? " filled" : "") + (i === state.idx ? " current" : "");
      track.appendChild(t);
    }
    body.appendChild(track);

    const card = document.createElement("div");
    card.className = "larp-prompt-card";
    const meta = document.createElement("div");
    meta.className = "larp-prompt-meta";
    meta.textContent = row.category || "\u2014";
    const text = document.createElement("div");
    text.className = "larp-prompt-text";
    // textContent, never innerHTML: prompt text is data (it may contain "<" or "&").
    // KaTeX then renders the math it finds between \( \) / \[ \] / $$ $$ delimiters
    // (the convention the prompt CSVs are built with); a malformed expression stays
    // visible as source, and without KaTeX loaded the plain text still shows.
    text.textContent = row.prompt_text;
    if(window.renderMathInElement){
      window.renderMathInElement(text, {
        throwOnError: false, trust: false,
        delimiters: [{left: "\\(", right: "\\)", display: false},
                     {left: "\\[", right: "\\]", display: true},
                     {left: "$$", right: "$$", display: true}]
      });
    }
    card.appendChild(meta);
    card.appendChild(text);
    body.appendChild(card);

    const q = document.createElement("div");
    q.className = "larp-field";
    q.textContent = "If the local model were asked to solve this prompt, how likely is it that the local model Gemma4-e2b would produce a satisfactory answer?";
    body.appendChild(q);

    const current = state.ratings[row.prompt_id];
    body.appendChild(buildBandGrid({
      interactive: true,
      selected: current ? current.level : undefined,
      onSelect: (level) => {
        const ms = state.itemStart ? (Date.now() - state.itemStart) : "";
        state.ratings[row.prompt_id] = { rating: RATINGS[level], level: level, ms };
        renderPanel();
      }
    }));

    p.appendChild(body);
    p.appendChild(foot);
    // Forward-only navigation: participants are told they cannot return to a previous prompt.
    const isLast = state.idx === total - 1;
    const next = navBtn(isLast ? "Continue to wrap-up" : "Next prompt", () => {
      if(isLast){ state.step = 6; } else { state.idx += 1; }
      state.itemStart = Date.now();
      render();
    }, {disabled: !current});
    foot.appendChild(document.createElement("span"));
    foot.appendChild(next);
  }

  function stepPostTask(p, body, foot){
    heading(p, "After the task");
    body.innerHTML = `
      <label class="larp-field">Attention check <span class="larp-field-hint">\u2014 please select \u201cLikely\u201d here.</span></label>
      <select class="larp-input" id="larp-att">
        <option value="">Please select</option>
        ${RATINGS.map(r => `<option value="${r}" ${state.attention===r?"selected":""}>${r}</option>`).join("")}
      </select>
      <label class="larp-field">Optional comments <span class="larp-field-hint">(optional)</span></label>
      <textarea class="larp-input" id="larp-reflect" placeholder="What made your judgements easier or harder?">${state.reflection}</textarea>
    `;
    p.appendChild(body);
    p.appendChild(foot);
    const next = navBtn("Continue", () => { state.step = 7; render(); });
    foot.appendChild(document.createElement("span"));
    foot.appendChild(next);
    body.querySelector("#larp-att").onchange = (e) => state.attention = e.target.value;
    body.querySelector("#larp-reflect").oninput = (e) => state.reflection = e.target.value;
  }

  function stepDemographics(p, body, foot){
    heading(p, "About you", "Only used for statistical analysis, no identifying data.");
    body.innerHTML = `
      <label class="larp-field">Gender</label>
      <select class="larp-input" id="larp-gender">
        <option value="">Please select</option>
        <option value="female">female</option>
        <option value="male">male</option>
        <option value="non-binary">non-binary</option>
        <option value="prefer not to say">prefer not to say</option>
      </select>
      <label class="larp-field">Age</label>
      <input class="larp-input" type="number" id="larp-age" min="14" max="110" />
      <label class="larp-field">Educational background</label>
      <input class="larp-input" type="text" id="larp-edu" placeholder="e.g. Bachelor's, Master's, PhD" />
      <label class="larp-field">Occupation</label>
      <input class="larp-input" type="text" id="larp-occ" placeholder="e.g. student, employee" />
      <label class="larp-field">How often do you use GenAI platforms?</label>
      <select class="larp-input" id="larp-freq2">
        <option value="">Please select</option>
        ${FREQ_OPTIONS.map(f => `<option value="${f}">${f}</option>`).join("")}
      </select>
    `;
    p.appendChild(body);
    p.appendChild(foot);
    const back = navBtn("Back", () => { state.step = 6; render(); }, {ghost:true});
    const next = navBtn("Finish", () => { state.step = 8; render(); });
    foot.appendChild(back); foot.appendChild(next);
    body.querySelector("#larp-gender").onchange = e => state.demo.gender = e.target.value;
    body.querySelector("#larp-age").oninput = e => state.demo.age = e.target.value;
    body.querySelector("#larp-edu").oninput = e => state.demo.education = e.target.value;
    body.querySelector("#larp-occ").oninput = e => state.demo.occupation = e.target.value;
    body.querySelector("#larp-freq2").onchange = e => state.demo.freq2 = e.target.value;
  }

  // ── Submission ──────────────────────────────────────────────────────────
  // POST the finished CSV to the relay (worker/), which stores it and emails it.
  // Retries with backoff on network failure / 5xx / timeout; a 4xx is a bug on our
  // side and is not retried. Whatever happens, the download button stays: the
  // participant always leaves with their file, and an unsent copy is queued in
  // localStorage and retried on the next page load.
  const SUBMIT_URL = window.LARP_SUBMIT_URL || "";
  const SUBMIT_TOKEN = window.LARP_SUBMIT_TOKEN || "";
  const RETRY_DELAYS_MS = [1000, 3000, 9000];
  const REQUEST_TIMEOUT_MS = 15000;

  async function postOnce(payload){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Study-Token": SUBMIT_TOKEN },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      if(res.ok) return { ok: true };
      return { ok: false, retryable: res.status >= 500, detail: "HTTP " + res.status };
    } catch(err){
      const timedOut = err && err.name === "AbortError";
      return { ok: false, retryable: true, detail: timedOut ? "timeout" : (err && err.message) || "network error" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function submitWithRetry(payload, onStatus){
    if(!SUBMIT_URL) return { ok: false, detail: "no submit endpoint configured" };
    let last = null;
    for(let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++){
      if(attempt > 0){
        onStatus && onStatus(`Sending failed (${last.detail}) — retrying (${attempt}/${RETRY_DELAYS_MS.length})…`);
        await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
      } else {
        onStatus && onStatus("Sending your responses…");
      }
      last = await postOnce(payload);
      if(last.ok) return last;
      if(!last.retryable) break;
    }
    return last;
  }

  function queueUnsent(payload){
    try {
      const q = JSON.parse(localStorage.getItem(UNSENT_KEY) || "[]");
      if(!q.some(p => p.participant_id === payload.participant_id)) q.push(payload);
      localStorage.setItem(UNSENT_KEY, JSON.stringify(q));
    } catch(e){}
  }
  async function flushUnsent(){
    let q = [];
    try { q = JSON.parse(localStorage.getItem(UNSENT_KEY) || "[]"); } catch(e){ return; }
    if(!q.length || !SUBMIT_URL) return;
    const remaining = [];
    for(const payload of q){
      const r = await submitWithRetry(payload);
      if(!r.ok) remaining.push(payload);
    }
    try { localStorage.setItem(UNSENT_KEY, JSON.stringify(remaining)); } catch(e){}
  }

  function buildPayload(){
    return {
      participant_id: state.participantId,
      submitted_at: new Date().toISOString(),
      n_prompts: state.rows.length,
      n_rated: Object.keys(state.ratings).length,
      csv: buildOutputCSV()
    };
  }

  // A short celebration the first time the Done screen appears (not on reload,
  // and not for people who asked their OS for reduced motion).
  function celebrate(){
    if(state.celebrated) return;
    state.celebrated = true; save();
    if(typeof window.confetti !== "function") return;
    if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#2E7D5B", "#3B4FB8", "#E8A33D", "#D9536F"];
    const bursts = [
      { x: window.innerWidth * 0.50, y: window.innerHeight * 0.45 },
      { x: window.innerWidth * 0.25, y: window.innerHeight * 0.35 },
      { x: window.innerWidth * 0.75, y: window.innerHeight * 0.35 },
    ];
    bursts.forEach((position, i) => setTimeout(() => {
      try { window.confetti({ position, count: 90, velocity: 220, fade: true, color: colors }); }
      catch(e){ /* decoration only; never let it break the Done screen */ }
    }, i * 250));
  }

  function stepDone(p, body, foot){
    heading(p, "Thank you!", state.submitted ? "Your responses were received." : "Your responses are being submitted.");
    celebrate();
    const rated = Object.keys(state.ratings).length;
    body.innerHTML = `
      <div class="larp-summary-row"><span>Participant ID</span><span>${state.participantId}</span></div>
      <div class="larp-summary-row"><span>Prompts rated</span><span>${rated} / ${state.rows.length}</span></div>
      <div class="larp-mail-box" id="larp-submit-status">Sending your responses…</div>
      <div class="larp-mail-box" id="larp-fallback" style="display:none;">
        Automatic sending did not go through. Please:<br/>
        1.&nbsp;Download the annotated CSV below.<br/>
        2.&nbsp;Attach the file to an email to <strong>noah.meissner@stud.uni-regensburg.de</strong><br/>
        3.&nbsp;Subject line: <em>LARP RQ2 \u2013 ${state.participantId}</em>
      </div>
    `;
    p.appendChild(body);
    p.appendChild(foot);
    const status = body.querySelector("#larp-submit-status");
    const fallback = body.querySelector("#larp-fallback");

    const dl = navBtn("Download annotated CSV", () => {
      const csv = buildOutputCSV();
      const blob = new Blob([csv], {type: "text/csv"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `larp_${state.participantId}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
    const mail = navBtn("Open email draft", () => {
      window.open(`mailto:noah.meissner@stud.uni-regensburg.de?subject=${encodeURIComponent("LARP RQ2 - " + state.participantId)}&body=${encodeURIComponent("Attached is my annotated CSV file from the LARP study.")}`, "_blank");
    }, {ghost:true});
    foot.appendChild(mail); foot.appendChild(dl);

    if(state.submitted){
      status.textContent = "Your responses were received. You may close this page.";
      return;
    }
    const payload = buildPayload();
    submitWithRetry(payload, msg => { status.textContent = msg; }).then(r => {
      if(r.ok){
        state.submitted = true; save();
        const sub = p.querySelector(".larp-sub"); if(sub) sub.textContent = "Your responses were received.";
        status.textContent = "Your responses were received. Thank you — you may close this page. (A copy is available below.)";
      } else {
        queueUnsent(payload);
        status.textContent = "Automatic sending failed: " + r.detail + ".";
        fallback.style.display = "";
      }
    });
  }

  restore();
  flushUnsent();
  render();
})();
