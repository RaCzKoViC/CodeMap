// `codemap rules` i narzędzie MCP `propose_rules`: propozycja .codemap.rules.json z warstw macierzy zależności
// (CM.DSM.proposeRules — ta sama co w oknie DSM aplikacji). Reguły dziś przechodzą, istniejące zależności pod prąd
// są wyjątkami do naprawy.

/** → {mode, rules, exceptions, text, forbidden} (zwykłe obiekty, nie z kontekstu vm) */
export function proposeRules(CM, graph, { mode, depth = 1, lang = 'pl' } = {}) {
  const p = CM.DSM.proposeRules(graph, { mode: mode === 'packages' || mode === 'folders' ? mode : undefined, depth: Math.max(1, Math.min(3, +depth || 1)), lang });
  const forbidden = p.rules.forbid.reduce((s, x) => s + (Array.isArray(x.to) ? x.to.length : 1), 0);
  return { ...structuredClone({ mode: p.mode, rules: p.rules, exceptions: p.exceptions }), text: p.text, forbidden };
}

/** Wiersze wyjątków: „a → b (n)". */
export const exceptionLines = (p) => p.exceptions.map((x) => `${x.from} → ${x.to} (${x.count})`);

/** Odpowiedź narzędzia MCP (po angielsku — odbiorcą jest agent). */
export function proposalText(p) {
  const exc = exceptionLines(p);
  return `${p.mode}: ${p.rules.layers.length} layers, ${exc.length} upstream dependencies to fix` + (exc.length ? ':\n' + exc.map((x) => '- ' + x).join('\n') : '')
    + '\n\n.codemap.rules.json:\n' + p.text;
}
