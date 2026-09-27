// Executes only the trusted, checked-out app source. No browser or network access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
if (!script.includes('\nboot();\n')) throw new Error('Update the audit boot hook');
const source = script.replace('\nboot();\n', '\n');
const fixedTime = Date.parse('2026-09-28T12:00:00Z');

function createApp() {
  const storage = new Map();
  const elements = new Map();
  let seed = 42;
  const math = Object.create(Math);
  math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedTime])); }
    static now() { return fixedTime; }
  }
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', value: '', textContent: '', focus() {}, remove() {},
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    Date: FixedDate, Math: math,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    document: {
      getElementById: element, querySelector: () => null, querySelectorAll: () => [],
    },
    location: { hash: '', origin: 'https://trainer.invalid', pathname: '/' },
    window: { addEventListener() {} },
    self: { crypto: { getRandomValues: values => values.fill(7) } },
    setTimeout() {},
    fetch: async () => { throw new Error('Unmocked network call'); },
  });
  vm.runInContext(source, context, { filename: 'index.html', timeout: 1000 });
  return {
    context,
    run: code => vm.runInContext(code, context, { timeout: 1000 }),
  };
}

async function main() {
  const report = {};
  let app = createApp();
  report.content = app.run(`(() => {
    const words = allWords(), sentences = CONTENT.weeks.flatMap(w => w.sentences);
    const ids = [...words, ...sentences].map(x => x.id);
    return { weeks: CONTENT.weeks.length, words: words.length, sentences: sentences.length,
      uniqueIds: new Set(ids).size === ids.length,
      validGaps: sentences.every(s => s.gap.o.filter(o => o === s.gap.a).length === 1) };
  })()`);
  report.freshSession = app.run(`(() => {
    const list = buildSession();
    return { length: list.length, words: new Set(list.filter(e => e.w).map(e => e.w.id)).size,
      sentences: list.filter(e => e.s).length,
      validOptions: list.filter(e => e.opts).every(e => e.opts.filter(o => o === e.correct).length === 1) };
  })()`);
  report.smoke = app.run(`(() => {
    const list = buildSession(); list.forEach(e => grade(e, true)); finishSession();
    const saved = load();
    return { xp: saved.xp, expectedXp: list.length * CFG.xpRight,
      days: saved.dates.length, streak: saved.streak,
      itemSchema: Object.values(saved.items).every(r => typeof r.seen === 'boolean' && Number.isFinite(r.due)),
      backup: localStorage.getItem(KEY + '-bak1') !== null };
  })()`);

  app = createApp();
  report.crowdedSession = app.run(`(() => {
    S.week = 2; allWords().forEach(w => Object.assign(rec(w.id), {seen:true, box:1, due:0}));
    const list = buildSession();
    return { length: list.length, sentences: list.filter(e => e.s).length };
  })()`);

  app = createApp();
  report.sameDayProgression = app.run(`(() => {
    for (let i = 0; i < 4; i++) { buildSession().forEach(e => grade(e, true)); finishSession(); }
    return { week: S.week, days: S.dates.length };
  })()`);

  app = createApp();
  report.merge = app.run(`(() => {
    const a = fresh(), b = fresh();
    a.xp = 20; b.xp = 12;
    a.items.hello = { seen:true, box:2, due:20726, ok:2, bad:0 };
    b.items.hello = { seen:true, box:0, due:20724, ok:1, bad:1 };
    const ab = merge(a,b), ba = merge(b,a);
    return { xp: ab.xp, expectedXp:22, attempts:ab.items.hello.ok + ab.items.hello.bad,
      expectedAttempts:3, orderIndependent:JSON.stringify(ab.items) === JSON.stringify(ba.items) };
  })()`);

  app = createApp();
  app.run(`S.name = 'Demo'; S.key = 'aaaaaaaaaaaaaaaa'; S.dev = 'aaaaaa';
    S.xp = 10; S.dirty = true; S.rev = 2; setSyncUrl('https://sync.invalid');`);
  let requests = [];
  app.context.fetch = async (_url, options = {}) => {
    requests.push(options.method || 'GET');
    return { ok:true, status:200, json:async () => ({
      name:'Demo', key:'aaaaaaaaaaaaaaaa', items:{}, dates:[], rev:1, xp:0,
    }) };
  };
  await app.run('boot()');
  report.pendingSync = { uploaded: requests.includes('PUT'), dirty: app.run('!!S.dirty') };

  app = createApp();
  app.run(`S.name = 'Local demo'; S.key = 'aaaaaaaaaaaaaaaa'; S.dev = 'aaaaaa';
    S.xp = 120; rec('hello').seen = true; setSyncUrl('https://sync.invalid');
    location.hash = '#k=bbbbbbbbbbbbbbbb';`);
  app.context.fetch = async () => ({ ok:true, status:200, json:async () => ({
    name:'Remote demo', key:'bbbbbbbbbbbbbbbb', items:{cat:{seen:true, box:1, due:0, ok:1, bad:0}},
    dates:[], xp:10, rev:1,
  }) });
  await app.run('boot()');
  report.profileSwitch = app.run(`({ oldItemsRetained:!!S.items.hello, remoteName:S.name === 'Remote demo' })`);

  app = createApp();
  app.run(`S.key = 'aaaaaaaaaaaaaaaa'; S.dev = 'aaaaaa'; setSyncUrl('https://sync.invalid');`);
  let respond;
  app.context.fetch = (_url, options) => {
    const snapshot = JSON.parse(options.body);
    return new Promise(resolve => { respond = () => resolve({
      ok:true, json:async () => ({state:snapshot}),
    }); });
  };
  const pending = app.run('push()');
  app.run(`grade({w:allWords()[0]}, true)`);
  respond();
  await pending;
  report.inFlightSync = app.run(`({ xp:S.xp, recorded:!!S.items.hello })`);

  app = createApp();
  report.partialSession = app.run(`(() => {
    grade({w:allWords()[0]}, true);
    return { saved:load().xp === 10, dirty:!!S.dirty };
  })()`);
  app.run(`S.key = 'aaaaaaaaaaaaaaaa'; S.dirty = true; setSyncUrl('https://sync.invalid');`);
  app.context.fetch = async () => ({ok:true, json:async () => {throw new Error('Invalid JSON');}});
  report.invalidAck = { accepted:await app.run('push()'), dirty:app.run('!!S.dirty') };
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
