# FormPilot / FormGen

A browser-first app that converts DOCX, text-based PDF, and TXT questionnaires into editable Google Forms.

## What now works

- Reads the selected DOCX using Mammoth.
- Reads selectable PDF text using PDF.js.
- Parses TXT files.
- Detects sections, numbered questions, choices, required fields, dates, paragraph answers, and scales.
- Populates the review editor from the actual uploaded document.
- Uses Google Identity Services for real account selection and OAuth consent.
- Calls `forms.create`, `forms.batchUpdate`, and `forms.setPublishSettings`.
- Returns genuine responder and edit links after publishing.
- Shows useful configuration and API errors instead of a fake success screen.

## Local testing

Serve the folder over HTTP:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Google Cloud setup

1. Create or select a Google Cloud project.
2. Enable **Google Forms API**.
3. Configure the OAuth consent screen.
4. Add test accounts while the app is in Testing mode.
5. Create an **OAuth Client ID → Web application**.
6. Add these Authorized JavaScript origins:
   - `http://localhost:8080`
   - `https://formpilot-app.vercel.app`
7. Open **Google setup** in FormPilot and paste the Client ID. Never paste a Client Secret.

The app requests `openid email profile` for account identity and `https://www.googleapis.com/auth/forms.body` when publishing.

## Security

- Documents are parsed in the browser.
- The Google access token is short-lived and stored in `sessionStorage`.
- No OAuth client secret is used.
- Form content is sent to Google only after the user presses Publish and grants consent.

## Current limitations

- Image-only/scanned PDFs require OCR and are not supported yet.
- Complex Word tables and grids may require manual adjustment.
- Skip-logic text is detected and flagged, but automatic routing is not yet generated.
- Public access to the Forms scope may require Google OAuth app verification.
