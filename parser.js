(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FormPilotParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SECTION_RE = /^(?:section|part|module)\s+[a-z0-9ivx]+\s*[:.\-]?\s*(.*)$/i;
  const QUESTION_RE = /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.)\-:]\s*(.+)$/i;
  const OPTION_RE = /^(?:[☐□▢○◯●•▪▫✓✔]|\(?[a-zA-Z0-9]{1,2}\)[.)]?|[a-zA-Z][.)]|[-–—])\s*(.+)$/;
  const ANSWER_LINE_RE = /^(?:answer\s*:\s*)?[_\.\-\s]{5,}$/i;
  const INSTRUCTION_RE = /^(?:instructions?|note|skip logic|if\s+.+(?:skip|go to|proceed)|thank you|purpose)\s*:/i;

  function cleanLine(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function stripNumber(text) {
    return cleanLine(text).replace(/^(?:q(?:uestion)?\s*)?\d{1,3}\s*[.)\-:]\s*/i, '').trim();
  }

  function isSection(line) {
    if (!line || line.length > 120) return false;
    if (SECTION_RE.test(line)) return true;
    const words = line.split(/\s+/);
    return words.length > 1 && words.length <= 9 && line === line.toUpperCase() && /[A-Z]/.test(line) && !/[?]/.test(line);
  }

  function sectionTitle(line) {
    const match = line.match(SECTION_RE);
    if (!match) return line.replace(/\s+/g, ' ').trim();
    const prefix = line.match(/^(section|part|module)\s+[a-z0-9ivx]+/i)?.[0] || 'Section';
    const tail = match[1] || '';
    return tail ? `${prefix}: ${tail}` : prefix;
  }

  function isQuestionStart(line) {
    return QUESTION_RE.test(line) || (/\?$/.test(line) && line.length < 260);
  }

  function parseOption(line) {
    const match = line.match(OPTION_RE);
    if (match) return cleanLine(match[1]);
    if (/^(?:yes|no)(?:\s*[/|]\s*(?:yes|no))+$/i.test(line)) {
      return line.split(/[/|]/).map(cleanLine).filter(Boolean);
    }
    return null;
  }

  function parseScale(line) {
    const pairs = [...line.matchAll(/(\d{1,2})\s*=\s*([^,\t]+?)(?=(?:\s{2,}|,\s*\d{1,2}\s*=|$))/g)];
    if (pairs.length >= 2) {
      const nums = pairs.map((m) => Number(m[1])).filter(Number.isFinite);
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      return {
        low: min,
        high: max,
        lowLabel: cleanLine(pairs.find((m) => Number(m[1]) === min)?.[2] || ''),
        highLabel: cleanLine(pairs.find((m) => Number(m[1]) === max)?.[2] || ''),
      };
    }
    const range = line.match(/\b(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\b/i);
    if (range) return { low: Number(range[1]), high: Number(range[2]), lowLabel: '', highLabel: '' };
    return null;
  }

  function inferType(question) {
    const text = `${question.title} ${question.description || ''}`.toLowerCase();
    if (question.scale && question.scale.high > question.scale.low) return 'SCALE';
    if (question.options.length) {
      if (/select all|tick all|check all|all that apply|up to \w+|up to \d+/.test(text)) return 'CHECKBOX';
      if (/dropdown|drop-down|choose your (?:county|country|department)/.test(text) || question.options.length >= 9) return 'DROP_DOWN';
      return 'RADIO';
    }
    if (/\bdate\b|date of response|date of birth/.test(text)) return 'DATE';
    if (/\btime\b/.test(text) && !/how (?:long|much time)/.test(text)) return 'TIME';
    if (/explain|describe|comment|suggestion|reason|why\b|feedback|experience|difficulty/.test(text)) return 'PARAGRAPH';
    return 'SHORT_ANSWER';
  }

  function normalizeQuestion(question, index) {
    const required = /\brequired\b|\*$/.test(question.title.toLowerCase()) && !/optional/.test(question.title.toLowerCase());
    let title = question.title
      .replace(/\s*\((?:required|optional)\)\s*/gi, ' ')
      .replace(/\s*\*\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    const type = inferType({ ...question, title });
    return {
      id: question.id || `q_${index + 1}`,
      sourceNumber: question.sourceNumber || String(index + 1),
      title,
      description: cleanLine(question.description || ''),
      type,
      required,
      options: [...new Set(question.options.map(cleanLine).filter(Boolean))],
      scale: question.scale || null,
      warning: question.warning || '',
      sourceLines: question.sourceLines || [],
    };
  }

  function parseText(rawText, meta) {
    const inputLines = String(rawText || '').split(/\r?\n/).map(cleanLine);
    const lines = inputLines.filter((line, index) => line || (index > 0 && inputLines[index - 1]));
    const titleCandidates = lines.filter(Boolean).slice(0, 4);
    const title = cleanLine(meta?.title || titleCandidates[0] || 'Untitled questionnaire');
    const descriptionCandidates = titleCandidates.slice(1).filter((line) => !isSection(line) && !isQuestionStart(line));
    const description = cleanLine(meta?.description || descriptionCandidates.join(' '));

    const sections = [];
    const warnings = [];
    let currentSection = { id: 'section_1', title: 'General', description: '', questions: [] };
    sections.push(currentSection);
    let currentQuestion = null;

    function finishQuestion() {
      if (!currentQuestion) return;
      const normalized = normalizeQuestion(currentQuestion, sections.reduce((n, section) => n + section.questions.length, 0));
      if (!normalized.title) {
        warnings.push('A question with no title was skipped.');
      } else {
        currentSection.questions.push(normalized);
      }
      currentQuestion = null;
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      if (i < 4 && titleCandidates.includes(line) && !isSection(line) && !isQuestionStart(line)) continue;

      if (isSection(line)) {
        finishQuestion();
        const titleValue = sectionTitle(line);
        if (currentSection.questions.length === 0 && currentSection.title === 'General') {
          currentSection.title = titleValue;
        } else {
          currentSection = { id: `section_${sections.length + 1}`, title: titleValue, description: '', questions: [] };
          sections.push(currentSection);
        }
        continue;
      }

      const questionMatch = line.match(QUESTION_RE);
      if (questionMatch || (isQuestionStart(line) && !OPTION_RE.test(line))) {
        finishQuestion();
        const sourceNumber = questionMatch ? questionMatch[1] : String(sections.reduce((n, section) => n + section.questions.length, 0) + 1);
        currentQuestion = {
          sourceNumber,
          title: stripNumber(questionMatch ? questionMatch[2] : line),
          description: '',
          options: [],
          scale: null,
          sourceLines: [line],
        };
        continue;
      }

      if (!currentQuestion) {
        if (INSTRUCTION_RE.test(line)) {
          currentSection.description = [currentSection.description, line].filter(Boolean).join(' ');
        }
        continue;
      }

      currentQuestion.sourceLines.push(line);
      const option = parseOption(line);
      if (Array.isArray(option)) {
        currentQuestion.options.push(...option);
        continue;
      }
      if (option) {
        currentQuestion.options.push(option);
        continue;
      }

      const scale = parseScale(line);
      if (scale) {
        currentQuestion.scale = scale;
        continue;
      }

      if (ANSWER_LINE_RE.test(line) || /^answer\s*:/i.test(line)) continue;
      if (/^skip logic\s*:/i.test(line) || /if\s+.+(?:skip|go to|proceed)/i.test(line)) {
        currentQuestion.description = [currentQuestion.description, line].filter(Boolean).join(' ');
        currentQuestion.warning = 'Skip logic detected. Review the destination section after publishing.';
        continue;
      }
      if (!INSTRUCTION_RE.test(line) && line.length < 240) {
        currentQuestion.description = [currentQuestion.description, line].filter(Boolean).join(' ');
      }
    }
    finishQuestion();

    const nonEmptySections = sections.filter((section) => section.questions.length || section.description);
    if (!nonEmptySections.length) warnings.push('No clearly structured questions were found. Add or edit questions in the review screen.');

    let totalQuestions = 0;
    nonEmptySections.forEach((section, sectionIndex) => {
      section.id = `section_${sectionIndex + 1}`;
      section.questions.forEach((question) => {
        totalQuestions += 1;
        question.id = `q_${totalQuestions}`;
      });
    });

    return {
      title,
      description,
      sections: nonEmptySections,
      warnings,
      stats: {
        sections: nonEmptySections.length,
        questions: totalQuestions,
        required: nonEmptySections.flatMap((section) => section.questions).filter((question) => question.required).length,
      },
      rawText: String(rawText || ''),
    };
  }

  async function extractDocx(file) {
    if (!globalThis.mammoth) throw new Error('The DOCX parser did not load. Refresh the page and try again.');
    const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: result.value, messages: result.messages || [] };
  }

  async function extractPdf(file) {
    if (!globalThis.pdfjsLib) throw new Error('The PDF parser did not load. Refresh the page and try again.');
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await globalThis.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pageTexts = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      let pageText = '';
      content.items.forEach((item) => {
        pageText += item.str;
        pageText += item.hasEOL ? '\n' : ' ';
      });
      pageTexts.push(pageText);
    }
    return { text: pageTexts.join('\n'), messages: [] };
  }

  async function parseFile(file) {
    if (!file) throw new Error('Choose a document first.');
    const extension = file.name.split('.').pop().toLowerCase();
    let extracted;
    if (extension === 'docx') extracted = await extractDocx(file);
    else if (extension === 'pdf') extracted = await extractPdf(file);
    else if (extension === 'txt') extracted = { text: await file.text(), messages: [] };
    else throw new Error('Unsupported file type. Upload DOCX, PDF, or TXT.');

    const result = parseText(extracted.text, { title: file.name.replace(/\.[^.]+$/, '') });
    if (extracted.messages.length) {
      result.warnings.push(...extracted.messages.map((message) => message.message || String(message)));
    }
    return result;
  }

  return { parseText, parseFile, inferType, parseScale };
});
