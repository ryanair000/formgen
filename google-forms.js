(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FormPilotGoogle = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMS_SCOPE = 'https://www.googleapis.com/auth/forms.body';
  const PROFILE_SCOPES = 'openid email profile';
  let tokenClient = null;
  let tokenResponse = null;

  function getClientId() {
    return (localStorage.getItem('formpilot_google_client_id') || globalThis.FORMPILOT_GOOGLE_CLIENT_ID || '').trim();
  }

  function setClientId(clientId) {
    const value = String(clientId || '').trim();
    if (value) localStorage.setItem('formpilot_google_client_id', value);
    else localStorage.removeItem('formpilot_google_client_id');
    tokenClient = null;
    return value;
  }

  function isConfigured() {
    return Boolean(getClientId());
  }

  function isConnected() {
    return Boolean(tokenResponse?.access_token && Number(tokenResponse.expires_at || 0) > Date.now());
  }

  function requireGoogleLibrary() {
    if (!globalThis.google?.accounts?.oauth2) {
      throw new Error('Google sign-in is still loading. Wait a moment and try again.');
    }
  }

  function requestToken(scopes, options) {
    requireGoogleLibrary();
    const clientId = getClientId();
    if (!clientId) throw new Error('Google OAuth Client ID is not configured. Open Settings and add it first.');
    return new Promise((resolve, reject) => {
      tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: scopes,
        prompt: options?.prompt || '',
        callback: (response) => {
          if (response?.error) {
            reject(new Error(response.error_description || response.error));
            return;
          }
          response.expires_at = Date.now() + Math.max(60, Number(response.expires_in || 3600) - 30) * 1000;
          tokenResponse = response;
          sessionStorage.setItem('formpilot_google_token', JSON.stringify(response));
          resolve(response);
        },
        error_callback: (error) => reject(new Error(error?.message || error?.type || 'Google sign-in failed.')),
      });
      tokenClient.requestAccessToken({ prompt: options?.prompt || 'select_account' });
    });
  }

  function restoreToken() {
    try {
      const stored = JSON.parse(sessionStorage.getItem('formpilot_google_token') || 'null');
      if (stored?.access_token && Number(stored.expires_at || 0) > Date.now()) tokenResponse = stored;
    } catch (_) {
      tokenResponse = null;
    }
    return tokenResponse;
  }

  async function connectForProfile() {
    const response = await requestToken(PROFILE_SCOPES, { prompt: 'select_account' });
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${response.access_token}` },
    });
    if (!profileResponse.ok) throw await apiError(profileResponse, 'Could not read the Google profile.');
    const profile = await profileResponse.json();
    localStorage.setItem('formpilot_google_profile', JSON.stringify(profile));
    return profile;
  }

  async function authorizeForms() {
    const scopes = `${PROFILE_SCOPES} ${FORMS_SCOPE}`;
    return requestToken(scopes, { prompt: 'consent' });
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
        const low = Math.max(0, Math.min(10, Number(question.scale?.low ?? 1)));
        const high = Math.max(low + 1, Math.min(10, Number(question.scale?.high ?? 5)));
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
    } catch (_) {
      detail = await response.text().catch(() => '');
    }
    const error = new Error(detail || fallback || `Google API request failed (${response.status}).`);
    error.status = response.status;
    return error;
  }

  async function googleFetch(url, options) {
    if (!isConnected()) await authorizeForms();
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${tokenResponse.access_token}`,
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
    });
    if (response.status === 401) {
      await authorizeForms();
      return googleFetch(url, options);
    }
    if (!response.ok) throw await apiError(response);
    return response.json();
  }

  async function publishForm(form, onProgress) {
    if (!form?.sections?.length) throw new Error('The form has no sections or questions to publish.');
    const totalQuestions = form.sections.reduce((sum, section) => sum + section.questions.length, 0);
    if (!totalQuestions) throw new Error('Add at least one question before publishing.');

    onProgress?.('Connecting to Google…', 10);
    if (!isConnected()) await authorizeForms();

    onProgress?.('Creating the Google Form…', 28);
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
