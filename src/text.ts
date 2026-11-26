// Text machinery for Quarry: HTML extraction, tokenising, stopwords, stemming.
// Everything hand-written — no parsing or NLP libraries.

const STOPWORDS = new Set(
  (
    "a an the and or but if then else when at by for with about into through " +
    "after over between out against during without before under around among " +
    "am is are was were be been being have has had having do does did doing " +
    "would should could ought i you he she it we they them his her its our " +
    "their this that these those as of to in on from not no nor so too very " +
    "can will just than one two all any how what which who whom why"
  ).split(" "),
);

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
  "&ndash;": "–",
  "&mdash;": "—",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&sbquo;": "‚",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&bdquo;": "„",
  "&hellip;": "…",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
  "&laquo;": "«",
  "&raquo;": "»",
  "&middot;": "·",
  "&deg;": "°",
  "&plusmn;": "±",
  "&sup2;": "²",
  "&sup3;": "³",
  "&frac12;": "½",
  "&frac14;": "¼",
  "&frac34;": "¾",
  "&micro;": "µ",
  "&para;": "¶",
  "&sect;": "§",
  "&dagger;": "†",
  "&Dagger;": "‡",
  "&bull;": "•",
  "&prime;": "′",
  "&Prime;": "″",
  "&permil;": "‰",
  "&euro;": "€",
  "&pound;": "£",
  "&yen;": "¥",
  "&cent;": "¢",
  "&curren;": "¤",
  "&iexcl;": "¡",
  "&iquest;": "¿",
  "&brvbar;": "¦",
  "&uml;": "¨",
  "&ordf;": "ª",
  "&ordm;": "º",
  "&not;": "¬",
  "&macr;": "¯",
  "&acute;": "´",
  "&cedil;": "¸",
  "&szlig;": "ß",
  "&agrave;": "à",
  "&aacute;": "á",
  "&acirc;": "â",
  "&atilde;": "ã",
  "&auml;": "ä",
  "&aring;": "å",
  "&aelig;": "æ",
  "&ccedil;": "ç",
  "&egrave;": "è",
  "&eacute;": "é",
  "&ecirc;": "ê",
  "&euml;": "ë",
  "&igrave;": "ì",
  "&iacute;": "í",
  "&icirc;": "î",
  "&iuml;": "ï",
  "&ntilde;": "ñ",
  "&ograve;": "ò",
  "&oacute;": "ó",
  "&ocirc;": "ô",
  "&otilde;": "õ",
  "&ouml;": "ö",
  "&oslash;": "ø",
  "&ugrave;": "ù",
  "&uacute;": "ú",
  "&ucirc;": "û",
  "&uuml;": "ü",
  "&yacute;": "ý",
  "&yuml;": "ÿ",
  "&times;": "×",
  "&divide;": "÷",
  "&minus;": "−",
  "&infin;": "∞",
  "&ne;": "≠",
  "&le;": "≤",
  "&ge;": "≥",
  "&asymp;": "≈",
  "&rarr;": "→",
  "&larr;": "←",
  "&uarr;": "↑",
  "&darr;": "↓",
  "&harr;": "↔",
  "&check;": "✓",
};

export function decodeEntities(s: string): string {
  // Code points above U+10FFFF are invalid: String.fromCodePoint throws a
  // RangeError for them. Leave such entities untouched instead of crashing.
  const fromCodePoint = (n: number, raw: string): string =>
    Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
  // ONE pass over the text: the replacement text is never rescanned, so a
  // literal "&#38;lt;" (an author writing about the &lt; entity) decodes
  // to "&lt;" and stops there instead of double-decoding to "<".
  return s.replace(
    /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (m, body: string) => {
      if (body.startsWith("#")) {
        const n =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : Number(body.slice(1));
        return fromCodePoint(n, m);
      }
      // Exact case first (&Dagger; differs from &dagger;), then lowercase.
      return ENTITIES[`&${body};`] ?? ENTITIES[`&${body.toLowerCase()};`] ?? m;
    },
  );
}

export interface ExtractedPage {
  title: string;
  headings: string;
  text: string;
  links: string[];
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : "";

  // Prefer the <main> element when the page has one (documentation sites do);
  // it skips most navigation and footer boilerplate. Fall back to <article>,
  // then to the whole document.
  const mainMatch =
    html.match(/<main[\s\S]*?<\/main>/i) ?? html.match(/<article[\s\S]*?<\/article>/i);
  let body = mainMatch ? mainMatch[0] : html;
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const headingParts: string[] = [];
  const hRe = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hRe.exec(body)) !== null) headingParts.push(stripTags(hm[1]));

  const text = stripTags(body);

  const links: string[] = [];
  // href may be double-quoted, single-quoted, or unquoted (Node.js docs
  // use unquoted attributes — a quoted-only pattern silently finds nothing).
  const hrefRe = /<a\s[^>]*?href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1] ?? m[2] ?? m[3];
    try {
      links.push(new URL(href, pageUrl).toString());
    } catch {
      // not a usable URL — skip
    }
  }
  return { title, headings: headingParts.join(" "), text, links };
}

// Light suffix stemmer. Retrieval needs consistency, not beauty: promise,
// promises and promising all meet at "promis", which is what matters.
// (A full Porter stemmer is on the roadmap.)
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3) + "i";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  if (w.endsWith("ly") && w.length > 4) w = w.slice(0, -2);
  // silent final e: promise -> promis, so it meets promises/promising
  if (w.endsWith("e") && w.length > 4) w = w.slice(0, -1);
  if (
    w.length > 3 &&
    w[w.length - 1] === w[w.length - 2] &&
    !"aeiou".includes(w[w.length - 1])
  ) {
    w = w.slice(0, -1);
  }
  return w;
}

export function tokenize(text: string): string[] {
  // Language names written with symbols would otherwise vanish: splitting
  // on non-alphanumerics turns "C++" into a lone "c" (dropped as too
  // short) and "C#" likewise. Expand them to searchable word forms first;
  // the same expansion runs at index time and query time, so they meet.
  const prepared = text
    .toLowerCase()
    .replace(/c\+\+/g, " cpp ")
    .replace(/c#/g, " csharp ");
  const raw = prepared.split(/[^a-z0-9]+/);
  const out: string[] = [];
  for (const tok of raw) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    out.push(stem(tok));
  }
  return out;
}
