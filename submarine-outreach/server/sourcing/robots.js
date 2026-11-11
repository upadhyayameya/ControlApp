/** Minimal robots.txt support: returns a predicate path => allowed for our user agent. */
export function parseRobots(text, agent = 'submarineoutreachbot') {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (!lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (field === 'disallow' || field === 'allow') current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  const rules = applicable.flatMap((g) => g.rules).filter((r) => r.path !== '' || r.allow);
  return (path) => {
    let best = null;
    for (const r of rules) {
      if (!r.path) continue;
      const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
      if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    }
    return best ? best.allow : true;
  };
}
