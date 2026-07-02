// Shared reply post-processing — single source of truth for server.js and
// telephony/bridge.js (premortem #9: the duplicated lists could drift apart).
const EMOTIONS = ['warm', 'excited', 'empathetic', 'calm', 'urgent', 'amused', 'reassuring', 'concerned', 'proud', 'gentle', 'encouraging', 'apologetic', 'serious'];
const TTS_LANGS = new Set(['te-IN', 'hi-IN', 'en-IN', 'ta-IN', 'kn-IN', 'ml-IN', 'mr-IN']);
const CONVO_LANGS = new Set(['te-IN', 'hi-IN', 'en-IN']);

const tagRegex = () =>
  new RegExp(`(?:~~)?\\s*([a-z]{2,3}-IN)\\s*\\|\\s*(${EMOTIONS.join('|')})(?:~~|\\|)?`, 'gi');

// Tolerant parse of the hidden "~~te-IN|warm~~" tag (also catches malformed variants).
function parseTag(raw, fallbackLang) {
  let lang = TTS_LANGS.has(fallbackLang) ? fallbackLang : 'te-IN';
  let emotion = 'warm';
  const re = tagRegex();
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (TTS_LANGS.has(m[1])) lang = m[1];
    emotion = m[2].toLowerCase();
  }
  const text = raw.replace(tagRegex(), '').replace(/[*_#`>~]+/g, '').replace(/\s{2,}/g, ' ').trim();
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
    [/రుసుము/g, 'fees'], [/నమోదు/g, 'registration'],
    [/ధన్యవాదములు/g, 'థాంక్స్ అండి'], [/ధన్యవాదాలు/g, 'థాంక్స్ అండి'],
    [/కళాశాల/g, 'college'],
    [/ఆలోచించండి/g, 'ఒకసారి చూడండి'], [/ప్రయత్నించండి/g, 'try చేయండి'],
    [/ఆలోచిస్తున్నారా/g, 'అనుకుంటున్నారా'], [/ప్రయత్నిస్తున్నారా/g, 'try చేస్తున్నారా'],
  ];
  for (const [p, r] of rules) text = text.replace(p, r);
  return text;
}

// Acronym phonetics the TTS engine mispronounces (BiPC experiment, 2026-07-02).
function ttsPhonetics(text, lang) {
  const bipc = lang === 'te-IN' ? 'బైపీసీ' : lang === 'hi-IN' ? 'बाय पी सी' : 'By-P-C';
  return text
    .replace(/b\.i\.p\.c\.?/gi, bipc)
    .replace(/b\s+i\s+p\s+c/gi, bipc)
    .replace(/bipc/gi, bipc);
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

module.exports = { parseTag, acousticFor, applyRegister, ttsPhonetics, nextPersonaLang, CONVO_LANGS };
