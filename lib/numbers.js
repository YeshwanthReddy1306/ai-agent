// Deterministic number → natural spoken words, applied in the TTS delivery layer
// (after the LLM). This makes "reading numericals grammatically" impossible regardless
// of what the model emits — a prompt/temperature/persona change can never regress it.
//
// It reads numbers the way a real Hyderabadi counselor speaks them: English number
// words, transliterated into the reply's script (te/hi) or left plain (en). Matches the
// persona's own examples: 9.2 -> "నైన్ పాయింట్ టూ", 95000 -> "నైంటీ ఫైవ్ థౌజండ్", 30 -> "థర్టీ".

const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

// English words (Indian numbering: thousand / lakh / crore)
function intToWords(n) {
  if (n === 0) return 'zero';
  if (n < 0) return 'minus ' + intToWords(-n);
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(intToWords(crore), 'crore');
  if (lakh) parts.push(intToWords(lakh), 'lakh');
  if (thousand) parts.push(intToWords(thousand), 'thousand');
  if (hundred) parts.push(ONES[hundred], 'hundred');
  if (n) {
    if (n < 20) parts.push(ONES[n]);
    else {
      const t = TENS[Math.floor(n / 10)];
      const o = n % 10;
      parts.push(o ? `${t} ${ONES[o]}` : t);
    }
  }
  return parts.join(' ');
}

// Transliteration of the ~40 number words into each script. Bounded + accurate.
const TRANSLIT = {
  'te-IN': {
    zero:'జీరో',one:'వన్',two:'టూ',three:'త్రీ',four:'ఫోర్',five:'ఫైవ్',six:'సిక్స్',seven:'సెవెన్',eight:'ఎయిట్',nine:'నైన్',ten:'టెన్',
    eleven:'ఇలెవన్',twelve:'ట్వెల్వ్',thirteen:'థర్టీన్',fourteen:'ఫోర్టీన్',fifteen:'ఫిఫ్టీన్',sixteen:'సిక్స్టీన్',seventeen:'సెవెంటీన్',eighteen:'ఎయిటీన్',nineteen:'నైంటీన్',
    twenty:'ట్వెంటీ',thirty:'థర్టీ',forty:'ఫోర్టీ',fifty:'ఫిఫ్టీ',sixty:'సిక్స్టీ',seventy:'సెవెంటీ',eighty:'ఎయిటీ',ninety:'నైంటీ',
    hundred:'హండ్రెడ్',thousand:'థౌజండ్',lakh:'లక్ష',crore:'కోటి',point:'పాయింట్',percent:'పర్సెంట్',minus:'మైనస్',rupees:'రూపాయలు'
  },
  'hi-IN': {
    zero:'ज़ीरो',one:'वन',two:'टू',three:'थ्री',four:'फोर',five:'फाइव',six:'सिक्स',seven:'सेवन',eight:'एट',nine:'नाइन',ten:'टेन',
    eleven:'इलेवन',twelve:'ट्वेल्व',thirteen:'थर्टीन',fourteen:'फोर्टीन',fifteen:'फिफ्टीन',sixteen:'सिक्स्टीन',seventeen:'सेवन्टीन',eighteen:'एटीन',nineteen:'नाइन्टीन',
    twenty:'ट्वेंटी',thirty:'थर्टी',forty:'फोर्टी',fifty:'फिफ्टी',sixty:'सिक्स्टी',seventy:'सेवन्टी',eighty:'एटी',ninety:'नाइन्टी',
    hundred:'हंड्रेड',thousand:'थाउज़ेंड',lakh:'लाख',crore:'करोड़',point:'पॉइंट',percent:'परसेंट',minus:'माइनस',rupees:'रुपये'
  },
};

function toScript(words, lang) {
  const map = TRANSLIT[lang];
  if (!map) return words; // en-IN: leave English words as-is
  return words.split(' ').map((w) => map[w] || w).join(' ');
}

// Read a number token (digits, optional commas/decimal) into spoken words.
function numberToSpoken(numStr, lang) {
  const clean = numStr.replace(/,/g, '');
  const neg = clean.startsWith('-');
  const [intPart, decPart] = clean.replace(/^-/, '').split('.');
  
  let words;
  if (intPart.length >= 10) {
    words = intPart.split('').map((d) => ONES[Number(d)]).join(' ');
  } else {
    words = intToWords(Number(intPart));
  }
  
  if (decPart) {
    words += ' point ' + decPart.split('').map((d) => ONES[Number(d)]).join(' ');
  }
  if (neg) words = 'minus ' + words;
  return toScript(words, lang);
}

// Replace every number in the text with its spoken form. Handles ₹, %, commas, decimals.
function spokenNumbers(text, lang) {
  // ₹95,000 or ₹1,00,000 -> "<words> rupees"
  text = text.replace(/₹\s?([\d,]+(?:\.\d+)?)/g, (_, n) => {
    const w = numberToSpoken(n, lang);
    const r = (TRANSLIT[lang] && TRANSLIT[lang].rupees) || 'rupees';
    return `${w} ${r}`;
  });
  // 92% -> "<words> percent"
  text = text.replace(/([\d,]+(?:\.\d+)?)\s?%/g, (_, n) => {
    const w = numberToSpoken(n, lang);
    const p = (TRANSLIT[lang] && TRANSLIT[lang].percent) || 'percent';
    return `${w} ${p}`;
  });
  // bare numbers (incl. decimals/commas). Skip if attached to letters (e.g. "v3", "24x7").
  text = text.replace(/(?<![\w])(\d[\d,]*(?:\.\d+)?)(?![\w])/g, (m) => numberToSpoken(m, lang));
  return text.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { spokenNumbers, numberToSpoken, intToWords };
