// Shared reply post-processing — single source of truth for server.js and
// telephony/bridge.js (premortem #9: the duplicated lists could drift apart).
const EMOTIONS = ['warm', 'excited', 'empathetic', 'calm', 'urgent', 'amused', 'reassuring', 'concerned', 'proud', 'gentle', 'encouraging', 'apologetic', 'serious'];
const TTS_LANGS = new Set(['te-IN', 'hi-IN', 'en-IN', 'ta-IN', 'kn-IN', 'ml-IN', 'mr-IN']);
const CONVO_LANGS = new Set(['te-IN', 'hi-IN', 'en-IN']);

const tagRegex = () =>
  new RegExp(`(?:~~)?\\s*([a-z]{2,3}-IN)\\s*\\|\\s*(${EMOTIONS.join('|')})(?:~~|\\|)?`, 'gi');

// If the LLM omits the tag (~1 in 20 after the stronger reminder), infer a SENSIBLE emotion
// from the reply's content instead of a dumb 'warm' default — so delivery is correct ~99%+.
function inferEmotion(text) {
  const t = (text || '').toLowerCase();
  if (/congrat|excellent|proud|బాగుంది|గొప్ప|అభినంద|शानदार|बधाई|rank|topper|9\.|marks|percent/.test(t)) return 'proud';
  if (/scholar|\bfee|fees|ఫీజు|స్కాలర్|फीस|financ|టైట్|installment|payment|lakh|thousand/.test(t)) return 'serious';
  if (/భయపడ|tension|worr|కష్ట|అర్థం చేసుకున్న|समझ|don.?t worry|reassur|ఆందోళన/.test(t)) return 'reassuring';
  if (/sorry|క్షమించ|మన్నించ|माफ|apolog|misheard|తప్పు/.test(t)) return 'apologetic';
  if (/all the best|ఆల్ ది బెస్ట్|మంచి జరగాల|శుభ|take care|దీవెన|goodbye/.test(t)) return 'warm';
  if (/campus|visit|రండి|slot|saturday|sunday|book|కలవండి/.test(t)) return 'encouraging';
  return 'warm';
}

// Tolerant parse of the hidden "~~te-IN|warm~~" tag (also catches malformed variants).
function parseTag(raw, fallbackLang) {
  let lang = TTS_LANGS.has(fallbackLang) ? fallbackLang : 'te-IN';
  let emotion = 'warm';
  let tagFound = false;
  const re = tagRegex();
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (TTS_LANGS.has(m[1])) lang = m[1];
    emotion = m[2].toLowerCase();
    tagFound = true;
  }
  // Strip ALL tag-shaped fragments from the SPOKEN text — including malformed ones with
  // emotions outside the whitelist — so junk like "te-IN|caring" can never be read aloud.
  // (The whitelist above still gates which emotions are ACCEPTED for delivery.)
  let text = raw
    .replace(/(?:~~)?\s*[a-z]{2,3}-IN\s*\|\s*[a-zA-Z]+\s*(?:~~|\|)?/gi, '')
    .replace(/[*_#`>~]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Belt-and-suspenders for the Groq emotion-word leak ("…, serious ~~en-IN|serious~~"):
  // strip a trailing bare emotion word ONLY when comma-separated (the leak signature) —
  // never a legitimate sentence-final word like "make you proud" (no comma).
  text = text.replace(new RegExp(`,\\s*(${EMOTIONS.join('|')})\\s*$`, 'i'), '').trim();
  // Tag missing entirely? Infer a correct emotion from the reply instead of defaulting to warm.
  if (!tagFound) emotion = inferEmotion(text);
  return { text, lang, emotion };
}

// Premortem #5 fix (H2): keep ONE acoustic voice per call, but anchor it to the LEAD's
// language — a pure-English lead keeps the en-IN model instead of a forced Telugu accent.
function acousticFor(lang, leadLanguage) {
  if (lang !== 'en-IN') return lang;
  if (leadLanguage === 'te') return 'te-IN';
  if (leadLanguage === 'hi') return 'hi-IN';
  return 'en-IN';
}

// Urban Hyderabad register, now gender-correct (premortem #5: బిడ్డ was force-replaced
// with "boy" even for daughters).
function applyRegister(text, lead) {
  const child = lead?.gender === 'female' ? 'అమ్మాయి' : 'అబ్బాయి';
  const rules = [
    [/కుమారుడు/g, 'అబ్బాయి'], [/కుమారుని/g, 'అబ్బాయిని'], [/పుత్రుడు/g, 'అబ్బాయి'],
    [/కుమార్తె/g, 'అమ్మాయి'], [/పుత్రిక/g, 'అమ్మాయి'],
    [/బిడ్డ/g, child],
    [/రుసుము/g, 'ఫీజు'], [/నమోదు/g, 'రిజిస్ట్రేషన్'],
    [/ధన్యవాదములు/g, 'థాంక్స్ అండి'], [/ధన్యవాదాలు/g, 'థాంక్స్ అండి'],
    [/కళాశాల/g, 'కాలేజీ'],
    [/ఆలోచించండి/g, 'ఒకసారి చూడండి'], [/ప్రయత్నించండి/g, 'ట్రై చేయండి'],
    [/ఆలోచిస్తున్నారా/g, 'అనుకుంటున్నారా'], [/ప్రయత్నిస్తున్నారా/g, 'ట్రై చేస్తున్నారా'],
    [/\bమరియు\b/g, 'ఇంకా'], [/లక్ష్యం/g, 'గోల్'], [/లక్ష్యమా/g, 'గోల్ ఆ'], 
    [/ఆసక్తి/g, 'ఇంట్రెస్ట్'], [/వివరాలు/g, 'డీటెయిల్స్'], [/ముఖ్యం/g, 'ఇంపార్టెంట్'],
    [/మాట్లాడుకుందాం/g, 'మాట్లాడదాం'], [/చేస్తాను/g, 'చేస్తానండి'],
  ];
  for (const [p, r] of rules) text = text.replace(p, r);
  return text;
}

// Acronym phonetics the TTS engine mispronounces.
function ttsPhonetics(text, lang) {
  if (lang === 'en-IN') {
    return text.replace(/b\.?i\.?p\.?c\.?/gi, 'B I P C').replace(/m\.?p\.?c\.?/gi, 'M P C');
  }
  
  const rules = lang === 'te-IN' ? [
    [/b\.?i\.?p\.?c\.?/gi, 'బైపీసీ'],
    [/m\.?p\.?c\.?/gi, 'ఎంపీసీ'],
    [/i\.?i\.?t\.?/gi, 'ఐఐటీ'],
    [/j\.?e\.?e\.?/gi, 'జెఈఈ'],
    [/n\.?e\.?e\.?t\.?/gi, 'నీట్'],
    [/p\.?c\.?m\.?/gi, 'పీసీఎం'],
    [/m\.?p\.?s\.?c\.?/gi, 'ఎంపీఎస్సీ'],
    [/\bwhatsapp\b/gi, 'వాట్సాప్'],
    [/\bscholarship\b/gi, 'స్కాలర్షిప్']
  ] : [ // hi-IN
    [/b\.?i\.?p\.?c\.?/gi, 'बाय पी सी'],
    [/m\.?p\.?c\.?/gi, 'एम पी सी'],
    [/i\.?i\.?t\.?/gi, 'आई आई टी'],
    [/j\.?e\.?e\.?/gi, 'जे ई ई'],
    [/n\.?e\.?e\.?t\.?/gi, 'नीट'],
    [/p\.?c\.?m\.?/gi, 'पी सी एम'],
    [/m\.?p\.?s\.?c\.?/gi, 'एम पी एस सी']
  ];

  let out = text;
  for (const [p, r] of rules) out = out.replace(p, r);
  return out;
}

// Language mirroring: the persona follows the caller's language. threshold = how many
// consecutive turns in a NEW language before switching. Default 1 = instant mirroring
// (user requirement: "if I change the language, it should also change"). Set
// LANG_SWITCH_TURNS=2 if STT misdetections on code-mixed speech ever ping-pong a call.
// state: { personaLang, streak: { lang, count } }  → returns true if the persona switched.
function nextPersonaLang(state, detected, threshold = 1) {
  if (!CONVO_LANGS.has(detected) || detected === state.personaLang) {
    state.streak = { lang: null, count: 0 };
    return false;
  }
  if (state.streak.lang === detected) state.streak.count++;
  else state.streak = { lang: detected, count: 1 };
  if (state.streak.count >= threshold) {
    state.personaLang = detected;
    state.streak = { lang: null, count: 0 };
    return true;
  }
  return false;
}

// Per-turn drift guard appended to every LLM call (never stored in history): pins the
// reply language, the brevity contract, and the hidden tag. Shared by server and bridge
// so web calls and phone calls can never diverge.
const LANG_LABEL = { 'te-IN': 'TELUGU (Telugu script)', 'hi-IN': 'HINDI (Devanagari script)', 'en-IN': 'ENGLISH' };
function formatReminder(personaLang) {
  const label = LANG_LABEL[personaLang] || 'ENGLISH';
  const scriptRule = personaLang === 'hi-IN' ? ' Do NOT use any English Latin letters; transliterate all English words and acronyms into Devanagari script.' : ' You may use English Latin letters for domain words.';
  return {
    role: 'user',
    content: `SYSTEM REMINDER: You MUST reply ENTIRELY in ${label}.${scriptRule} Reply with 1 or 2 short sentences. Speak extremely casually and naturally like a real human from the city — NEVER sound like you are reading a formal script or news. Maintain your colloquial persona. Choose the emotion tag DELIBERATELY from your EMOTION PALETTE. The emotion word goes ONLY inside the tag. MANDATORY: every reply MUST end with the tag ~~${personaLang}|<emotion>~~ as the VERY LAST thing you write. Never forget the tag.`,
  };
}

module.exports = { parseTag, acousticFor, applyRegister, ttsPhonetics, nextPersonaLang, formatReminder, CONVO_LANGS };
