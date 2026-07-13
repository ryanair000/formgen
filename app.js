(() => {
  'use strict';

  const P = window.FormPilotParser;
  const G = window.FormPilotGoogle;
  const root = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const toastRoot = document.getElementById('toast-root');
  const TYPES = ['SHORT_ANSWER', 'PARAGRAPH', 'RADIO', 'CHECKBOX', 'DROP_DOWN', 'SCALE', 'DATE', 'TIME'];
  const TYPE_LABEL = {
    SHORT_ANSWER: 'Short answer',
    PARAGRAPH: 'Paragraph',
    RADIO: 'Multiple choice',
    CHECKBOX: 'Checkboxes',
    DROP_DOWN: 'Dropdown',
    SCALE: 'Linear scale',
    DATE: 'Date',
    TIME: 'Time',
  };

  const state = {
    form: load('formpilot_form', null),
    file: null,
    selectedSection: 0,
    selectedQuestion: 0,
    profile: G.getProfile(),
    published: load('formpilot_published', null),
    publishBusy: false,
    publishLabel: 'Waiting for Google authorization…',
    publishPercent: 5,
  };

  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (_) { return fallback; }
  }
  function saveForm() {
    if (state.form) localStorage.setItem('formpilot_form', JSON.stringify(state.form));
  }
  function esc(value = '') {
    return String(value).replace(/[&<>'\"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;',
    }[character]));
  }
  function route() { return location.hash.slice(1) || '/'; }
  function go(path) { location.hash = path; }
  function btn(text, kind = 'primary', attrs = '') {
    return `<button class="btn btn-${kind}" ${attrs}>${text}</button>`;
  }
  function logo() {
    return '<a class="logo" href="#/"><span class="logo-mark">F</span><span>FormPilot</span></a>';
  }
  function countQuestions(form = state.form) {
    return form?.sections?.reduce((total, section) => total + section.questions.length, 0) || 0;
  }
  function refreshStats() {
    if (!state.form) return;
    state.form.stats = {
      sections: state.form.sections.length,
      questions: countQuestions(),
      required: state.form.sections.flatMap((section) => section.questions).filter((question) => question.required).length,
    };
  }
  function toast(message, type = '') {
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.textContent = message;
    toastRoot.appendChild(element);
    setTimeout(() => element.remove(), 6000);
  }
  function showError(error) {
    console.error(error);
    toast(error?.message || String(error), 'error');
  }
  function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function setupModal(afterSave) {
    const origin = location.origin;
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">
      <div class="modal-header"><div><span class="section-label">GOOGLE SETUP</span><h2>Connect Google Forms</h2></div><button class="modal-close" data-close>×</button></div>
      <p class="muted">Use a Google OAuth Web Client ID. The client secret must never be placed in this browser app.</p>
      <ol class="setup-steps">
        <li>Enable the Google Forms API.</li>
        <li>Add your account as an OAuth test user.</li>
        <li>Create a Web application OAuth Client ID.</li>
        <li>Add this Authorized JavaScript origin: <code class="code-value">${esc(origin)}</code></li>
      </ol>
      <label class="field">OAuth Client ID<input id="client-id" value="${esc(G.getClientId())}" placeholder="123.apps.googleusercontent.com"></label>
      <div class="form-actions">${btn('Cancel', 'secondary', 'data-close')}${btn('Save', 'primary', 'id="save-google"')}</div>
    </div></div>`;
    modalRoot.querySelectorAll('[data-close]').forEach((element) => {
      element.onclick = () => { modalRoot.innerHTML = ''; };
    });
    modalRoot.querySelector('#save-google').onclick = () => {
      const value = modalRoot.querySelector('#client-id').value.trim();
      if (!/\.apps\.googleusercontent\.com$/.test(value)) {
        toast('Enter a valid Google OAuth Client ID.', 'error');
        return;
      }
      G.setClientId(value);
      modalRoot.innerHTML = '';
      toast('Google Client ID saved.', 'success');
      afterSave?.();
    };
  }

  function oauthHelp(error) {
    modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">
      <div class="modal-header"><div><span class="section-label">GOOGLE AUTHORIZATION</span><h2>Google did not finish connecting</h2></div><button class="modal-close" data-close>×</button></div>
      <div class="error-box"><b>${esc(error?.message || 'Google authorization did not complete.')}</b></div>
      <ol class="setup-steps">
        <li>Allow pop-ups for <code class="code-value">${esc(location.origin)}</code>.</li>
        <li>Confirm your Google account is listed as an OAuth test user.</li>
        <li>Confirm the OAuth client has the exact JavaScript origin above, without a trailing slash.</li>
        <li>Return to the editor and click <b>Publish to Google Forms</b> again.</li>
      </ol>
      <div class="form-actions">${btn('Back to editor', 'secondary', 'data-back-review')}${btn('Try Google again', 'primary', 'data-retry-google')}</div>
    </div></div>`;
    modalRoot.querySelectorAll('[data-close]').forEach((element) => {
      element.onclick = () => { modalRoot.innerHTML = ''; };
    });
    modalRoot.querySelector('[data-back-review]').onclick = () => {
      modalRoot.innerHTML = '';
      go('/review');
    };
    modalRoot.querySelector('[data-retry-google]').onclick = () => {
      modalRoot.innerHTML = '';
      publish();
    };
  }

  async function connectGoogle() {
    if (!G.isConfigured()) {
      setupModal(() => connectGoogle().catch((error) => oauthHelp(error)));
      return;
    }
    try {
      state.profile = await G.connectForProfile();
      render();
      toast(`Connected as ${state.profile.email || state.profile.name}`, 'success');
    } catch (error) {
      oauthHelp(error);
    }
  }

  function disconnectGoogle() {
    G.disconnect();
    state.profile = null;
    render();
    toast('Google account disconnected.');
  }

  function publicHeader() {
    const account = state.profile
      ? `<span class="account-chip">${esc(state.profile.email || state.profile.name)}</span>${btn('Dashboard', 'primary', 'data-go="/dashboard"')}`
      : `${btn('Sign in with Google', 'google', 'data-connect')}${btn('Start free', 'primary', 'data-go="/upload"')}`;
    return `<header class="site-header">${logo()}<nav class="site-nav"><a href="#how">How it works</a><a href="#features">Features</a><a href="#security">Security</a></nav><div class="header-actions">${account}</div></header>`;
  }

  function landing() {
    return `${publicHeader()}<main>
      <section class="hero"><div><span class="eyebrow">DOCUMENT → GOOGLE FORM</span><h1>Turn questionnaires into real Google Forms</h1><p>Upload a DOCX, text-based PDF, or TXT questionnaire. FormPilot extracts the actual questions and lets you edit everything before Google creates the form.</p><div class="hero-buttons">${btn('Convert a document →', 'primary', 'data-go="/upload"')}${btn('Download test document', 'secondary', 'data-sample')}</div><div class="trust-points"><span>✓ Browser-based parsing</span><span>✓ User-approved Google consent</span><span>✓ Editable before publishing</span></div></div>
      <div class="product-visual"><div class="visual-card upload-visual"><span class="file-tile">W</span><span class="file-tile pdf">PDF</span><span class="drop-mini">⇧ Upload document</span></div><div class="visual-card processing-visual"><b>Extracting your questionnaire…</b><div class="progress-track"><div class="progress-fill" style="width:76%"></div></div><p class="check-line">✓ Reading document text</p><p class="check-line">✓ Detecting sections and options</p><p class="muted small">○ Preparing editable review</p></div></div></section>
      <section id="how" class="public-section"><div class="section-heading"><span class="section-label">HOW IT WORKS</span><h2>Upload, review, publish</h2></div><div class="steps-grid">${[
        ['⇧', 'Upload', 'Choose a DOCX, text-based PDF, or TXT file.'],
        ['✦', 'Review', 'Edit detected sections, question types, and options.'],
        ['G', 'Publish', 'Select a Google account and create the real Google Form.'],
      ].map((item, index) => `<article class="step-card"><div class="icon-box">${item[0]}</div><span class="step-number">0${index + 1}</span><h3>${item[1]}</h3><p>${item[2]}</p></article>`).join('')}</div></section>
      <section id="features" class="public-section features-section"><div class="section-heading"><span class="section-label">FEATURES</span><h2>A useful first-pass converter</h2></div><div class="features-grid">${[
        ['DOCX', 'Reads Word questionnaire text with Mammoth.'],
        ['PDF', 'Reads selectable PDF text with PDF.js.'],
        ['Types', 'Detects choices, paragraphs, dates, and scales.'],
        ['Editor', 'Lets you correct every generated item.'],
        ['OAuth', 'Uses the real Google account and consent dialog.'],
        ['Forms', 'Creates and publishes through the Google Forms API.'],
      ].map((item) => `<article class="feature-card"><div class="icon-box">${item[0][0]}</div><div><h3>${item[0]}</h3><p>${item[1]}</p></div></article>`).join('')}</div></section>
      <section id="security" class="showcase"><div class="showcase-copy"><span class="section-label">PRIVACY</span><h2>The questionnaire is parsed in your browser</h2><p>The file is not uploaded to a FormPilot server. Google receives the reviewed form structure only after you approve access.</p><ul class="benefits"><li>✓ No client secret in the browser</li><li>✓ Short-lived Google access tokens</li><li>✓ Clear authorization errors and retry controls</li></ul>${btn('Try a questionnaire', 'primary', 'data-go="/upload"')}</div><div class="editor-demo"><div class="editor-demo-top"><b>Questionnaire review</b><span class="blue">Saved · Preview · Publish</span></div><div class="editor-demo-body"><aside class="editor-demo-sidebar"><b>Document outline</b><span>Section A · 6</span><span>Section B · 5</span></aside><div class="editor-demo-canvas"><h3>Section A: Respondent Details</h3><div class="mock-question"><span>1. Email address</span><small>Short answer</small></div><div class="mock-question"><span>2. Age group</span><small>Multiple choice</small></div></div></div></div></section>
      <section class="dark-cta"><h2>Build your first real form</h2><p>Upload, review, and authorize Google only when you are ready.</p>${btn('Start conversion →', 'primary', 'data-go="/upload"')}</section>
    </main>${footer()}`;
  }

  function footer() {
    return `<footer class="site-footer"><div>${logo()}<p>Documents in. Google Forms out.</p></div><div class="footer-column"><b>Product</b><a href="#features">Features</a><a href="#how">How it works</a></div><div class="footer-column"><b>Resources</b><a data-sample>Test document</a><a href="https://github.com/ryanair000/formgen" target="_blank" rel="noopener">GitHub</a></div><div class="footer-column"><b>Google</b><a data-go="/settings">OAuth setup</a><a href="https://developers.google.com/forms/api" target="_blank" rel="noopener">Forms API</a></div></footer>`;
  }

  function shell(title, body, active = '') {
    const account = state.profile
      ? `<span class="account-chip">${esc(state.profile.email || state.profile.name)}</span>`
      : btn('Connect Google', 'google', 'data-connect');
    return `<div class="app-shell"><aside class="app-sidebar">${logo()}<nav class="app-nav"><button class="${active === 'dashboard' ? 'active' : ''}" data-go="/dashboard">▣ Overview</button><button class="${active === 'upload' ? 'active' : ''}" data-go="/upload">＋ New conversion</button><button class="${active === 'settings' ? 'active' : ''}" data-go="/settings">⚙ Google setup</button></nav><div class="sidebar-bottom"><div class="plan-card"><b>Browser-first MVP</b><p class="muted small">DOCX · PDF · TXT · Google Forms</p></div></div></aside><div class="app-main"><header class="app-topbar"><h1>${esc(title)}</h1><div class="header-actions">${account}</div></header><main class="app-content">${body}</main></div></div>`;
  }

  function dashboard() {
    const questions = countQuestions();
    return shell('Overview', `<section class="welcome-card"><div><span class="section-label">FORMPILOT WORKSPACE</span><h2>${state.form ? 'Continue your questionnaire' : 'Convert your first document'}</h2><p class="muted">${state.form ? `${esc(state.form.title)} has ${questions} detected questions.` : 'Upload a questionnaire to create an editable review draft.'}</p></div>${btn(state.form ? 'Continue review' : 'New conversion →', 'primary', `data-go="${state.form ? '/review' : '/upload'}"`)}</section><div class="stats-grid"><div class="stat-card"><b>${state.form?.stats?.sections || 0}</b><span>Sections</span></div><div class="stat-card"><b>${questions}</b><span>Questions</span></div><div class="stat-card"><b>${state.form?.stats?.required || 0}</b><span>Required</span></div><div class="stat-card"><b>${state.profile ? 'Yes' : 'No'}</b><span>Google connected</span></div></div><section class="panel"><div class="panel-head"><h3>Current project</h3>${state.form ? btn('Delete', 'danger', 'data-delete-project') : ''}</div>${state.form ? `<div class="project-row" data-go="/review"><span class="project-icon">▣</span><div><b>${esc(state.form.title)}</b><p class="muted small">${questions} questions · ${state.form.sections.length} sections</p></div><span class="status-pill">Review draft</span><span>${esc(state.form.fileName || 'Saved locally')}</span></div>` : `<div class="empty-state"><h3>No questionnaire yet</h3><p class="muted">Upload your own document or download the sample.</p><div class="header-actions">${btn('Upload document', 'primary', 'data-go="/upload"')}${btn('Download sample', 'secondary', 'data-sample')}</div></div>`}</section>`, 'dashboard');
  }

  function upload() {
    return shell('New conversion', `<div class="narrow"><section class="upload-panel"><div class="upload-heading"><span class="section-label">DOCUMENT PARSING</span><h2>Create a form from your questionnaire</h2><p>DOCX and TXT work directly. PDFs must contain selectable text.</p></div><label class="big-drop" id="drop-zone"><input id="file-input" type="file" accept=".docx,.pdf,.txt"><span class="upload-icon">⇧</span><b id="file-label">Drag and drop or click to choose a document</b><span class="muted" id="file-meta">DOCX, PDF, or TXT · Maximum 20 MB</span></label><div class="form-grid"><label class="field">Document language<select id="language"><option>Auto-detect</option><option>English</option><option>Kiswahili</option></select></label><label class="field">Form purpose<select id="purpose"><option>Survey</option><option>Quiz</option><option>Registration</option><option>Application</option></select></label></div><div class="warning-box"><b>Google authorization happens only after review.</b> The account window opens directly from your Publish click.</div><div class="form-actions">${btn('Download sample', 'secondary', 'data-sample')}${btn('Process document →', 'primary', 'id="process-file" disabled')}</div></section></div>`, 'upload');
  }

  function processing() {
    return shell('Processing', `<section class="processing-card"><div class="icon-box center">✦</div><h2>Reading your document</h2><p class="muted" id="progress-text">Preparing parser…</p><div class="progress-track"><div class="progress-fill" style="width:5%"></div></div><ol class="processing-steps"><li>Uploading document</li><li>Reading document text</li><li>Detecting sections and questions</li><li>Identifying question types</li><li>Preparing review</li></ol></section>`, 'upload');
  }

  function setProgress(label, percent, completedIndex) {
    const text = document.getElementById('progress-text');
    const fill = document.querySelector('.processing-card .progress-fill');
    if (text) text.textContent = label;
    if (fill) fill.style.width = `${percent}%`;
    document.querySelectorAll('.processing-steps li').forEach((item, index) => {
      item.classList.toggle('done', index <= completedIndex);
    });
  }

  async function processFile() {
    if (!state.file) return;
    const purpose = document.getElementById('purpose')?.value || 'Survey';
    go('/processing');
    render();
    const steps = ['Uploading document', 'Reading document text', 'Detecting sections and questions', 'Identifying question types', 'Preparing review'];
    try {
      setProgress(steps[0], 15, 0);
      await wait(150);
      setProgress(steps[1], 30, 1);
      const result = await P.parseFile(state.file);
      result.fileName = state.file.name;
      result.purpose = purpose;
      state.form = result;
      refreshStats();
      saveForm();
      for (let index = 2; index < steps.length; index += 1) {
        setProgress(steps[index], 55 + ((index - 2) * 20), index);
        await wait(130);
      }
      toast(`Extracted ${result.stats.questions} questions from ${state.file.name}.`, 'success');
      state.selectedSection = 0;
      state.selectedQuestion = 0;
      go('/review');
    } catch (error) {
      go('/upload');
      render();
      showError(error);
    }
  }

  function current() {
    const section = state.form?.sections?.[state.selectedSection];
    const question = section?.questions?.[state.selectedQuestion];
    return { section, question };
  }

  function questionPreview(question) {
    if (question.options?.length) {
      return question.options.map((option) => `<label class="choice-row"><input type="${question.type === 'CHECKBOX' ? 'checkbox' : 'radio'}" disabled> ${esc(option)}</label>`).join('');
    }
    if (question.type === 'PARAGRAPH') return '<textarea disabled placeholder="Long answer text"></textarea>';
    if (question.type === 'DATE') return '<input type="date" disabled>';
    if (question.type === 'TIME') return '<input type="time" disabled>';
    if (question.type === 'SCALE') {
      const low = question.scale?.low ?? 1;
      const high = question.scale?.high ?? 5;
      return `<div class="scale-preview">${Array.from({ length: high - low + 1 }, (_, index) => `<span>${low + index}</span>`).join('')}</div>`;
    }
    return '<input disabled placeholder="Short answer text">';
  }

  function review() {
    if (!state.form) return dashboard();
    const { section, question } = current();
    return `<div class="review-app"><header class="review-topbar"><button class="btn btn-ghost" data-go="/dashboard">←</button><div><b>${esc(state.form.title)}</b><p class="muted small">${countQuestions()} questions · saved in this browser</p></div><div class="top-actions">${btn('Preview', 'secondary', 'data-go="/preview"')}${btn('Publish to Google Forms', 'primary', 'data-publish')}</div></header><div class="review-body"><aside class="outline-panel"><h3>Document outline</h3>${state.form.sections.map((item, index) => `<button class="outline-button ${index === state.selectedSection ? 'active' : ''}" data-section="${index}"><span>${esc(item.title)}</span><b>${item.questions.length}</b></button>`).join('')}<button class="outline-button" data-add-section>＋ Add section</button></aside><main class="review-canvas"><div class="canvas-heading"><div><h2>${esc(section.title)}</h2><p class="muted">${section.questions.length} questions</p></div>${btn('＋ Add question', 'secondary', 'data-add-question')}</div>${section.questions.map((item, index) => `<article class="question-card ${index === state.selectedQuestion ? 'selected' : ''}" data-question="${index}"><div class="question-header"><span class="question-number">${index + 1}</span><div><b class="question-title">${esc(item.title)}</b>${item.description ? `<p class="muted small">${esc(item.description)}</p>` : ''}</div>${item.warning ? '<span class="review-warning">Check logic</span>' : ''}</div><div class="answer-preview">${questionPreview(item)}</div></article>`).join('')}</main><aside class="properties-panel">${question ? properties(question) : '<p class="muted">Select a question.</p>'}</aside></div></div>`;
  }

  function properties(question) {
    return `<div class="property-section"><h3>Question settings</h3><label class="field">Question title<textarea id="q-title">${esc(question.title)}</textarea></label><label class="field">Question type<select id="q-type">${TYPES.map((type) => `<option value="${type}" ${question.type === type ? 'selected' : ''}>${TYPE_LABEL[type]}</option>`).join('')}</select></label><label class="inline-toggle">Required<input id="q-required" type="checkbox" ${question.required ? 'checked' : ''}></label></div>${['RADIO', 'CHECKBOX', 'DROP_DOWN'].includes(question.type) ? `<div class="property-section"><div class="panel-head"><h3>Options</h3>${btn('＋', 'secondary', 'data-add-option')}</div><div class="option-editor">${(question.options || []).map((option, index) => `<div class="option-line"><input data-option="${index}" value="${esc(option)}"><button class="btn btn-danger btn-sm" data-remove-option="${index}">×</button></div>`).join('')}</div></div>` : ''}<div class="property-section"><div class="confidence"><b>✓ Parsed from the uploaded document</b><br>Review before publishing.</div>${btn('Delete question', 'danger', 'data-delete-question')}</div>`;
  }

  function preview() {
    if (!state.form) return dashboard();
    return shell('Form preview', `<div class="preview-toolbar">${btn('← Back to editor', 'secondary', 'data-go="/review"')}${btn('Publish to Google Forms', 'primary', 'data-publish')}</div><article class="preview-paper"><div class="preview-accent"></div><h1>${esc(state.form.title)}</h1>${state.form.description ? `<p class="muted">${esc(state.form.description)}</p>` : ''}<small class="muted">* Required</small>${state.form.sections.map((section) => `<section class="preview-section"><h2>${esc(section.title)}</h2>${section.questions.map((question) => `<div class="preview-question"><b>${esc(question.title)} ${question.required ? '<span class="required-star">*</span>' : ''}</b>${questionPreview(question)}</div>`).join('')}</section>`).join('')}</article>`);
  }

  function setPublishProgress(label, percent) {
    state.publishLabel = label;
    state.publishPercent = percent;
    const text = document.getElementById('publish-label');
    const fill = document.querySelector('.publish-progress .progress-fill');
    if (text) text.textContent = label;
    if (fill) fill.style.width = `${percent}%`;
  }

  async function publish() {
    if (!state.form || state.publishBusy) return;
    if (!G.isConfigured()) {
      setupModal(() => publish());
      return;
    }

    try {
      toast('Opening Google account authorization…');
      await G.authorizeForms();
      state.profile = G.getProfile() || state.profile;
    } catch (error) {
      oauthHelp(error);
      return;
    }

    state.publishBusy = true;
    state.publishLabel = 'Authorization approved. Creating your Google Form…';
    state.publishPercent = 12;
    go('/publishing');
    render();

    try {
      state.published = await G.publishForm(state.form, setPublishProgress);
      localStorage.setItem('formpilot_published', JSON.stringify(state.published));
      state.publishBusy = false;
      go('/success');
    } catch (error) {
      state.publishBusy = false;
      localStorage.setItem('formpilot_publish_error', error.message || String(error));
      go('/review');
      render();
      showError(error);
    }
  }

  function publishing() {
    if (!state.publishBusy) {
      return shell('Publishing', `<section class="processing-card"><div class="icon-box center">G</div><h2>Authorization was not completed</h2><p class="muted">Google did not return an access token, or this page was refreshed.</p><div class="warning-box">Allow pop-ups for this site, then retry from this button.</div><div class="form-actions center-actions">${btn('Back to editor', 'secondary', 'data-go="/review"')}${btn('Try Google again', 'primary', 'data-publish')}</div></section>`);
    }
    return shell('Publishing', `<section class="processing-card"><div class="icon-box center">G</div><h2>Creating your Google Form</h2><p class="muted" id="publish-label">${esc(state.publishLabel)}</p><div class="publish-progress"><div class="progress-track"><div class="progress-fill" style="width:${state.publishPercent}%"></div></div></div><p class="muted small">Google permission was approved. Keep this tab open while the form is created.</p></section>`);
  }

  function success() {
    if (!state.published) return dashboard();
    return shell('Published', `<section class="success-card"><div class="success-mark">✓</div><h2>Your Google Form is live</h2><p class="muted">The form was created in the authorized Google account and is accepting responses.</p><div class="link-box"><span class="link-value">${esc(state.published.responderUri)}</span>${btn('Copy', 'primary', 'data-copy-link')}</div><div class="header-actions center-actions"><a class="btn btn-primary" href="${esc(state.published.responderUri)}" target="_blank" rel="noopener">Open respondent form</a><a class="btn btn-secondary" href="${esc(state.published.editUri)}" target="_blank" rel="noopener">Edit in Google Forms</a></div><p>${btn('Return to dashboard', 'ghost', 'data-go="/dashboard"')}</p></section>`);
  }

  function settings() {
    return shell('Google setup', `<section class="panel settings-card"><span class="section-label">GOOGLE CLOUD</span><h2>OAuth and Forms API setup</h2><p class="muted">The browser app needs only the public OAuth Client ID.</p><ol class="setup-steps"><li>Enable Google Forms API.</li><li>Add your account as an OAuth test user.</li><li>Add <code class="code-value">${esc(location.origin)}</code> as an Authorized JavaScript origin.</li><li>Allow pop-ups for this site.</li></ol><label class="field">OAuth Client ID<input id="settings-client-id" value="${esc(G.getClientId())}"></label><div class="form-actions">${btn('Save Client ID', 'primary', 'data-save-client')}${state.profile ? btn('Disconnect Google', 'danger', 'data-disconnect') : btn('Test Google sign-in', 'google', 'data-connect')}</div>${state.profile ? `<div class="success-box"><b>Connected:</b> ${esc(state.profile.email || state.profile.name)}</div>` : '<div class="warning-box">Not connected yet. Test the account window here before publishing.</div>'}</section>`, 'settings');
  }

  function render() {
    const currentRoute = route();
    root.innerHTML = currentRoute === '/' ? landing()
      : currentRoute === '/dashboard' ? dashboard()
        : currentRoute === '/upload' ? upload()
          : currentRoute === '/processing' ? processing()
            : currentRoute === '/review' ? review()
              : currentRoute === '/preview' ? preview()
                : currentRoute === '/publishing' ? publishing()
                  : currentRoute === '/success' ? success()
                    : currentRoute === '/settings' ? settings()
                      : landing();
    bind();
    window.scrollTo(0, 0);
  }

  function bind() {
    root.querySelectorAll('[data-go]').forEach((element) => {
      element.onclick = () => go(element.dataset.go);
    });
    root.querySelectorAll('[data-connect]').forEach((element) => {
      element.onclick = connectGoogle;
    });
    root.querySelectorAll('[data-publish]').forEach((element) => {
      element.onclick = publish;
    });
    root.querySelectorAll('[data-sample]').forEach((element) => {
      element.onclick = () => {
        const link = document.createElement('a');
        link.href = './samples/FormPilot_Test_Questionnaire.txt';
        link.download = 'FormPilot_Test_Questionnaire.txt';
        link.click();
      };
    });
    root.querySelector('[data-disconnect]')?.addEventListener('click', disconnectGoogle);
    root.querySelector('[data-save-client]')?.addEventListener('click', () => {
      const value = document.getElementById('settings-client-id').value.trim();
      if (value && !/\.apps\.googleusercontent\.com$/.test(value)) {
        toast('Enter a valid Google OAuth Client ID.', 'error');
        return;
      }
      G.setClientId(value);
      state.profile = null;
      toast('Google Client ID saved.', 'success');
      render();
    });
    root.querySelector('[data-delete-project]')?.addEventListener('click', () => {
      if (confirm('Delete the local project?')) {
        state.form = null;
        localStorage.removeItem('formpilot_form');
        render();
      }
    });
    root.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(state.published.responderUri);
      toast('Responder link copied.', 'success');
    });

    const fileInput = document.getElementById('file-input');
    const drop = document.getElementById('drop-zone');
    if (fileInput && drop) {
      const choose = (file) => {
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) {
          toast('File is larger than 20 MB.', 'error');
          return;
        }
        state.file = file;
        document.getElementById('file-label').textContent = file.name;
        document.getElementById('file-meta').textContent = `${(file.size / 1024).toFixed(1)} KB · ready`;
        document.getElementById('process-file').disabled = false;
      };
      fileInput.onchange = (event) => choose(event.target.files[0]);
      drop.ondragover = (event) => { event.preventDefault(); drop.classList.add('dragging'); };
      drop.ondragleave = () => drop.classList.remove('dragging');
      drop.ondrop = (event) => {
        event.preventDefault();
        drop.classList.remove('dragging');
        choose(event.dataTransfer.files[0]);
      };
      document.getElementById('process-file').onclick = processFile;
    }

    root.querySelectorAll('[data-section]').forEach((element) => {
      element.onclick = () => {
        state.selectedSection = Number(element.dataset.section);
        state.selectedQuestion = 0;
        render();
      };
    });
    root.querySelectorAll('[data-question]').forEach((element) => {
      element.onclick = () => {
        state.selectedQuestion = Number(element.dataset.question);
        render();
      };
    });
    root.querySelector('[data-add-section]')?.addEventListener('click', () => {
      state.form.sections.push({ id: `section_${Date.now()}`, title: 'New section', description: '', questions: [] });
      state.selectedSection = state.form.sections.length - 1;
      state.selectedQuestion = 0;
      refreshStats();
      saveForm();
      render();
    });
    root.querySelector('[data-add-question]')?.addEventListener('click', () => {
      const section = state.form.sections[state.selectedSection];
      section.questions.push({ id: `q_${Date.now()}`, title: 'New question', description: '', type: 'SHORT_ANSWER', required: false, options: [], scale: null });
      state.selectedQuestion = section.questions.length - 1;
      refreshStats();
      saveForm();
      render();
    });

    const { question } = current();
    if (question) {
      const title = document.getElementById('q-title');
      const type = document.getElementById('q-type');
      const required = document.getElementById('q-required');
      title.oninput = (event) => { question.title = event.target.value; saveForm(); };
      type.onchange = (event) => {
        question.type = event.target.value;
        if (['RADIO', 'CHECKBOX', 'DROP_DOWN'].includes(question.type) && !(question.options || []).length) {
          question.options = ['Option 1', 'Option 2'];
        }
        saveForm();
        render();
      };
      required.onchange = (event) => {
        question.required = event.target.checked;
        refreshStats();
        saveForm();
      };
      root.querySelectorAll('[data-option]').forEach((element) => {
        element.oninput = (event) => {
          question.options[Number(element.dataset.option)] = event.target.value;
          saveForm();
        };
      });
      root.querySelectorAll('[data-remove-option]').forEach((element) => {
        element.onclick = () => {
          question.options.splice(Number(element.dataset.removeOption), 1);
          saveForm();
          render();
        };
      });
      root.querySelector('[data-add-option]')?.addEventListener('click', () => {
        question.options.push(`Option ${question.options.length + 1}`);
        saveForm();
        render();
      });
      root.querySelector('[data-delete-question]')?.addEventListener('click', () => {
        state.form.sections[state.selectedSection].questions.splice(state.selectedQuestion, 1);
        state.selectedQuestion = Math.max(0, state.selectedQuestion - 1);
        refreshStats();
        saveForm();
        render();
      });
    }
  }

  window.addEventListener('hashchange', render);
  render();
})();
