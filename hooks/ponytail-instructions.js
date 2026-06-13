// ponytail-instructions — shared ruleset builder consumed by every ponytail plugin.

const RULESETS = {
  lite: [
    '### ponytail (lite) — prefer simplicity',
    '- Favor standard library over new dependencies',
    '- Reduce unnecessary nesting and indirection',
    '- Mark intentional simplifications with `ponytail:` comment',
  ].join('\n'),

  full: [
    '### ponytail (full) — lazy senior dev mode',
    '',
    'Before writing any code, ask:',
    '- Does this need to exist at all? (YAGNI)',
    '- Does the standard library already do it?',
    '- Is it a native platform feature?',
    '- Can it be one line?',
    '',
    'Rules:',
    '- Build the minimum that works — no unrequested abstractions',
    '- No avoidable dependencies — question every import',
    '- No boilerplate — prefer declarative over imperative',
    '- One implementation is not a pattern — don\'t abstract it',
    '- If a framework/API has a simpler built-in way, use it',
    '- Mark intentional simplifications with `ponytail:` comment',
  ].join('\n'),

  ultra: [
    '### ponytail (ultra) — extreme minimalism',
    '',
    '- Ship nothing that isn\'t asked for',
    '- Zero new dependencies unless stdlib is impossible',
    '- Every function must earn its existence — delete anything optional',
    '- If it can be inlined, inline it',
    '- No types, no abstractions, no config files for speculative needs',
    '- Mark every deleted abstraction with `ponytail: deleted — reason`',
  ].join('\n'),
};

function getPonytailInstructions(mode) {
  return RULESETS[mode] || '';
}

module.exports = { getPonytailInstructions };
