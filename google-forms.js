(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FormPilotGoogle = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMS_SCOPE = 'https://www.googleapis.com/auth/forms.body';
  const PROFILE_SCOPES = 'openid email profile';
  const TOKEN_TIMEOUT_MS = 30000;
  let tokenResponse = null;

  function getClientId() {
    return (localStorage.getItem('formpilot_google_client_id') || globalThis.FORMPILOT_GOOGLE_CLIENT_ID || '').trim();
  }

  function setClientId(clientId) {
    const value = String(clientId || '').trim();
    if (value) localStorage.setItem('formpilot_google_client_id', value);
    else localStorage.removeItem('formpilot_google_client_id');
    tokenResponse = null;
    sessionStorage.removeItem('formpilot_google_token');
    return value;
  }

  function isConfigured() { return Boolean(getClientId()); }
  function tokenIsFresh() {
    return Boolean(tokenResponse?.access_token && Number(tokenResponse.expires_at || 0) > Date.now());
  }

  function requireGoogleLibrary() {
    if (!globalThis.google?.accounts?.oauth2) {
      throw new Error('Google authorization is still loading. Refresh the page, wait a few seconds, and try again.');
    }
  }

  function friendlyOAuthError(error) {
    const type = error?.type || error?.error || '';
    if (type === 'popup_failed_to_open') {
      return new Error('Google could not open the account window. Allow pop-ups for this site, then click Publish again.');
    }
    if (type === 'popup_closed') {
      return new Error('The Google account window was closed before authorization finished. Click Publish and complete the Google prompt.');
    }
    return new Error(error?.message || error?.error_description || type || 'Google authorization failed.');
  }

  function requestToken(scopes, options = {}) {
    requireGoogleLibrary();
    const clientId = getClientId();
    if (!clientId) throw new Error('Google OAuth Client ID is not configured. Open Google setup and add it first.');

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        finish(reject, new Error('Google did not return an authorization result. Allow pop-ups for formpilot-app.vercel.app, confirm this Google account is an OAuth test user, and try again.'));
      }, Number(options.timeoutMs || TOKEN_TIMEOUT_MS));

      try {
        const client = globalThis.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: scopes,
          callback: (response) => {
            if (response?.error) {
              finish(reject, friendlyOAuthError(response));
              return;
            }
            response.expires_at = Date.now() + Math.max(60, Number(response.expires_in || 3600) - 30) * 1000;
            tokenResponse = response;
            sessionStorage.setItem('formpilot_google_token', JSON.stringify(response));
            finish(resolve, response);
          },
          error_callback: (error) => finish(reject, friendlyOAuthError(error)),
        });

        client.requestAccessToken({ prompt: options.prompt || 'select_account' });
      } catch (error) {
        finish(reject, friendlyOAuthError(error));
      }
    });
  }

  function restoreToken() {
    try {
      const stored = JSON.parse(sessionStorage.getItem('formpilot_google_token') || 'null');
      if (stored?.access_token && Number(stored.expires_at || 0) > Date.now()) tokenResponse = stored;
    } catch (_) { tokenResponse = null; }
    return tokenResponse;
  }

  function hasScope(scope, response = tokenResponse) {
    if (!response?.access_token) return false;
    try {
      if (globalThis.google?.accounts?.oauth2?.hasGrantedAllScopes) {
        return globalThis.google.accounts.oauth2.hasGrantedAllScopes(response, scope);
      }
    } catch (_) {}
    return String(response.scope || '').split(/\s+/).includes(scope);
  }

  function isConnected() { return tokenIsFresh(); }
  function isFormsAuthorized() { return tokenIsFresh() && hasScope(FORMS_SCOPE); }

  async function fetchProfileWithToken(response = tokenResponse) {
    if (!response?.access_token) return null;
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${response.access_token}` },
    });
    if (!profileResponse.ok) throw await apiError(profileResponse, 'Could not read the Google profile.');
    const profile = await profileResponse.json();
    localStorage.setItem('formpilot_google_profile', JSON.stringify(profile));
    return profile;
  }

  async function connectForProfile() {
    const response = await requestToken(PROFILE_SCOPES, { prompt: 'select_account' });
    return fetchProfileWithToken(response);
  }

  async function authorizeForms() {
    const response = await requestToken(`${PROFILE_SCOPES} ${FORMS_SCOPE}`, { prompt: 'consent' });
    if (!hasScope(FORMS_SCOPE, response)) {
      throw new Error('Google did not grant permission to create Forms. Click Publish again and approve the Google Forms permission.');
    }
    try { await fetchProfileWithToken(response); } catch (_) {}
    return response;
  }

  function getProfile() {
    try { return JSON.parse(localStorage.getItem('formpilot_google_profile') || 'null'); }
    catch (_) { return null; }
  }

  function disconnect() {
    if (tokenResponse?.access_token && globalThis.google?.accounts?.oauth2) {
      globalThis.google.accounts.oauth2.revoke(tokenResponse.access_token, function () {});
    }
    tokenResponse = null;
    sessionStorage.removeItem('formpilot_google_token');
    localStorage.removeItem('formpilot_google_profile');
  }

  function questionPayload(question) {
    const base = { required: Boolean(question.required) };
    switch (question.type) {
      case 'PARAGRAPH': return { ...base, textQuestion: { paragraph: true } };
      case 'SHORT_ANSWER': return { ...base, textQuestion: { paragraph: false } };
      case 'DATE': return { ...base, dateQuestion: { includeTime: false, includeYear: true } };
      case 'TIME': return { ...base, timeQuestion: { duration: false } };
      case 'SCALE': {
        const low = Number(question.scale?.low) === 0 ? 0 : 1;
        const high = Math.max(3, Math.min(10, Number(question.scale?.high ?? 5)));
        return {
          ...base,
          scaleQuestion: {
            low,
            high,
            lowLabel: question.scale?.lowLabel || '',
            highLabel: question.scale?.highLabel || '',
          },
        };
      }
      case 'CHECKBOX':
      case 'DROP_DOWN':
      case 'RADIO':
      default: {
        const type = ['CHECKBOX', 'DROP_DOWN', 'RADIO'].includes(question.type) ? question.type : 'RADIO';
        const options = (question.options || []).filter(Boolean).map((value) => {
          const option = { value };
          if (/^other$/i.test(value)) option.isOther = true;
          return option;
        });
        if (!options.length) return { ...base, textQuestion: { paragraph: false } };
        return { ...base, choiceQuestion: { type, options, shuffle: false } };
      }
    }
  }

  function buildBatchRequests(form) {
    const requests = [];
    if (form.description) {
      requests.push({ updateFormInfo: { info: { description: form.description }, updateMask: 'description' } });
    }
    let index = 0;
    form.sections.forEach((section, sectionIndex) => {
      if (sectionIndex > 0 || section.title !== 'General') {
        requests.push({
          createItem: {
            item: { title: section.title, description: section.description || '', pageBreakItem: {} },
            location: { index },
          },
        });
        index += 1;
      }
      section.questions.forEach((question) => {
        requests.push({
          createItem: {
            item: {
              title: question.title,
              description: question.description || '',
              questionItem: { question: questionPayload(question) },
            },
            location: { index },
          },
        });
        index += 1;
      });
    });
    return requests;
  }

  async function apiError(response, fallback) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message || body?.error_description || '';
    } catch (_) { detail = await response.text().catch(() => ''); }
    const error = new Error(detail || fallback || `Google API request failed (${response.status}).`);
    error.status = response.status;
    return error;
  }

  async function googleFetch(url, options) {
    if (!isFormsAuthorized()) {
      throw new Error('Google Forms authorization is missing or expired. Return to the editor and click Publish again.');
    }
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    if (response.status === 401) {
      tokenResponse = null;
      sessionStorage.removeItem('formpilot_google_token');
      throw new Error('Your Google authorization expired. Return to the editor and click Publish again.');
    }
    if (!response.ok) throw await apiError(response);
    return response.json();
  }

  async function publishForm(form, onProgress) {
    if (!form?.sections?.length) throw new Error('The form has no sections or questions to publish.');
    const totalQuestions = form.sections.reduce((sum, section) => sum + section.questions.length, 0);
    if (!totalQuestions) throw new Error('Add at least one question before publishing.');
    if (!isFormsAuthorized()) {
      throw new Error('Authorize Google Forms first by clicking Publish from the editor.');
    }

    onProgress?.('Creating the Google Form…', 25);
    const created = await googleFetch('https://forms.googleapis.com/v1/forms?unpublished=true', {
      method: 'POST',
      body: JSON.stringify({ info: { title: form.title, documentTitle: form.title } }),
    });

    const requests = buildBatchRequests(form);
    onProgress?.(`Adding ${totalQuestions} questions…`, 55);
    const updated = await googleFetch(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(created.formId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ includeFormInResponse: true, requests }),
    });

    onProgress?.('Publishing and enabling responses…', 82);
    await googleFetch(`https://forms.googleapis.com/v1/forms/${encodeURIComponent(created.formId)}:setPublishSettings`, {
      method: 'POST',
      body: JSON.stringify({
        publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } },
        updateMask: 'publishState',
      }),
    });

    onProgress?.('Form published successfully.', 100);
    const finalForm = updated.form || created;
    return {
      formId: created.formId,
      responderUri: finalForm.responderUri || `https://docs.google.com/forms/d/${created.formId}/viewform`,
      editUri: `https://docs.google.com/forms/d/${created.formId}/edit`,
      title: form.title,
    };
  }

  restoreToken();
  return {
    FORMS_SCOPE,
    getClientId,
    setClientId,
    isConfigured,
    isConnected,
    isFormsAuthorized,
    getProfile,
    connectForProfile,
    authorizeForms,
    publishForm,
    disconnect,
    buildBatchRequests,
    questionPayload,
    restoreToken,
  };
});
