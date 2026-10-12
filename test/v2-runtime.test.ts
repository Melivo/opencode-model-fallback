import { expect, test } from "bun:test";

const config = { version: 2, cooldownMs: 60000, agents: { worker: { chain: [
  { model: "mock/a#high" }, { model: "mock/b#low", request: { body: { thinking: { type: "disabled" } } } }, { model: "mock/c#medium" }
] } } };
async function harness(ready = true, settings = config) {
  const module = await import("../src/v2").catch(() => ({} as any));
  expect(module.default?.setup).toBeFunction();
  const hooks: Record<string, Function> = {};
  const child: any = { id: "ses_child", parentID: "ses_parent", agent: "worker", model: { providerID: "mock", id: "a", variant: "high" } };
  const changes: any[] = [];
  const ctx: any = {
    options: { config: settings }, location: { directory: "/unused" },
    agent: { list: async () => ({data: ready ? [{ id: "worker", mode: "subagent" }] : []}) },
    model: { list: async () => ({data: ["a", "b", "c"].map(id => ({ id, providerID: "mock", variants: ["high", "low", "medium"].map(id => ({id})) }))}) },
    session: {
      get: async () => structuredClone(child),
      switchModel: async (x: any) => { changes.push(x); child.model = x.model; },
      hook: async (name: string, callback: Function) => { hooks[name] = callback; return { dispose: async () => {} }; }
    }
  };
  await module.default.setup(ctx);
  return { hooks, child, changes, ctx };
}

async function failCurrent(h: Awaited<ReturnType<typeof harness>>, attempt = 2) {
  const event: any = {sessionID:h.child.id, agent:"worker", model:structuredClone(h.child.model), attempt,
    error:{message:"TEST DATA rate limit",status:429}, decision:{retry:true,delay:2000}};
  await h.hooks.retry(event);
  return event;
}

test("v2 wraps to recovered Claude only after the forward pass", async () => {
  const h = await harness(true, {...config, maxCycles:5} as any);
  const now = Date.now;
  let clock = now();
  Date.now = () => clock;
  try {
    await failCurrent(h, 2);
    clock += 60001;
    await failCurrent(h, 3);
    expect(h.child.model.id).toBe("c");
    await failCurrent(h, 4);
    expect(h.child.model).toEqual({providerID:"mock",id:"a",variant:"high"});
  } finally { Date.now = now; }
});
test("v2 maxCycles rejects unsafe values rather than making retries unbounded", async () => {
  for (const maxCycles of [0, -1, 6, 1.5, "5", null, Infinity, NaN]) {
    await expect(harness(true, {...config, maxCycles} as any)).rejects.toThrow("maxCycles");
  }
});

test("v2 stale retry from an earlier pass cannot act on the same model after wrap", async () => {
  const h = await harness(true, {...config,maxCycles:5} as any);
  const now = Date.now;
  let clock = now(); Date.now = () => clock;
  try {
    const stale = await failCurrent(h, 2);
    clock += 60001;
    await failCurrent(h, 3);
    await failCurrent(h, 4);
    expect(h.child.model.id).toBe("a");
    stale.decision = {retry:true,delay:2000};
    await h.hooks.retry(stale);
    expect(h.child.model.id).toBe("a");
    expect(stale.decision).toEqual({retry:true,delay:2000});
  } finally { Date.now = now; }
});

test("v2 successful native step permits attempt counters to restart without resetting passes", async () => {
  const h = await harness(true, {...config,maxCycles:5} as any);
  await failCurrent(h, 2);
  expect(h.hooks["http.response"]).toBeFunction();
  await h.hooks["http.response"]({sessionID:h.child.id,agent:"worker",model:h.child.model,kind:"primary",response:new Response("TEST DATA",{status:200})});
  await failCurrent(h, 2);
  expect(h.child.model.id).toBe("c");
});

test("v2 omitted variant matches the runtime default variant", async () => {
  const settings = structuredClone(config);
  settings.agents.worker.chain[0].model = "mock/a";
  const {hooks, child, changes} = await harness(true, settings);
  child.model = {providerID:"mock",id:"a",variant:"default"};
  await hooks.retry({sessionID:child.id,agent:"worker",model:child.model,error:{message:"rate limit",status:429},decision:{retry:true,delay:2000}});
  expect(changes[0]?.model).toEqual({providerID:"mock",id:"b",variant:"low"});
});

test("v2 ignores root sessions and unknown agents without modifying retry policy", async () => {
  const {hooks, child, changes} = await harness();
  delete child.parentID;
  const event: any = {sessionID:child.id,agent:"worker",model:child.model,error:{message:"rate limit",status:429},decision:{retry:true,delay:2000}};
  await hooks.retry(event);
  expect(changes).toEqual([]);
  expect(event.decision).toEqual({retry:true,delay:2000});
  child.parentID = "ses_parent";
  event.agent = "unconfigured";
  await hooks.retry(event);
  expect(changes).toEqual([]);
});

test("v2 exhaustion stops retries without switching agent or parent", async () => {
  const {hooks, child, changes} = await harness();
  child.model = {providerID:"mock",id:"c",variant:"medium"};
  const event: any = {sessionID:child.id,agent:"worker",model:child.model,error:{message:"rate limit",status:429},decision:{retry:true,delay:2000}};
  await hooks.retry(event);
  expect(changes).toEqual([]);
  expect(event.decision).toEqual({retry:false});
});

test("v2 stale retry cannot move a child backwards in its chain", async () => {
  const {hooks, child, changes} = await harness();
  const stale = child.model;
  child.model = {providerID:"mock",id:"c",variant:"medium"};
  await hooks.retry({sessionID: child.id, agent:"worker",model:stale,error:{message:"rate limit",status:429},decision:{retry:true,delay:2}});
  expect(changes).toEqual([]);
});

test("v2 setup tolerates agent transforms not yet activated and hooks fail closed", async () => {
  const {hooks, child, changes} = await harness(false);
  await hooks.retry({sessionID: child.id, agent: "worker", model: child.model, error: {message: "rate limit", status:429}, decision:{retry:true,delay:2}});
  expect(changes).toEqual([]);
});

test("v2 body override is applied after variant defaults and never leaks to next provider", async () => {
  const {hooks, child} = await harness();
  expect(hooks["http.request"]).toBeFunction();
  const event: any = {sessionID: child.id, agent: "worker", kind: "primary", model: {providerID: "mock", id: "b", variant: "low"}, request: new Request("http://localhost/test", {method: "POST", body: JSON.stringify({model: "b", thinking: {type: "enabled", budget: 100}, messages: []})})};
  await hooks["http.request"](event);
  expect(await event.request.json()).toEqual({model: "b", thinking: {type: "disabled", budget: 100}, messages: []});
  event.model = {providerID: "mock", id: "c", variant: "medium"};
  event.request = new Request("http://localhost/test", {method: "POST", body: JSON.stringify({model: "c", messages: []})});
  await hooks["http.request"](event);
  expect(await event.request.json()).toEqual({model: "c", messages: []});
});

test("v2 preemptive redirect skips a known limited primary in another child", async () => {
  const {hooks, child, changes} = await harness();
  await hooks.retry({ sessionID: child.id, agent: "worker", model: child.model, error: {message: "rate limit", status: 429}, decision: {retry: true, delay: 2} });
  child.id = "ses_second";
  child.model = {providerID: "mock", id: "a", variant: "high"};
  expect(hooks.prompt).toBeFunction();
  await hooks.prompt({sessionID: child.id, prompt: {text: "unchanged test prompt"}});
  expect(changes[1]).toEqual({sessionID: "ses_second", model: {providerID: "mock", id: "b", variant: "low"}});
});

test("v2 reactive retry switches only the failing child model and preserves exact variant", async () => {
  const {hooks, child, changes} = await harness();
  const event: any = { sessionID: child.id, agent: "worker", model: child.model, error: { type: "rate_limit", message: "test 429", status: 429 }, decision: {retry: true, delay: 2000} };
  await hooks.retry(event);
  expect(changes).toEqual([{sessionID: "ses_child", model: {providerID: "mock", id: "b", variant: "low"}}]);
  expect(event.decision).toEqual({retry: true, delay: 0});
  expect(child.agent).toBe("worker");
  expect(child.parentID).toBe("ses_parent");
});

test("v2 five TOTAL passes stop without a sixth even when models recover", async () => {
  const h = await harness(true, {...config,maxCycles:5} as any);
  const now = Date.now;
  let clock = now(); Date.now = () => clock;
  try {
    const seen = [];
    for (let i = 0; i < 15; i++) {
      seen.push(h.child.model.id);
      clock += 60001;
      const event = await failCurrent(h, i + 2);
      expect(event.decision).toEqual(i === 14 ? {retry:false} : {retry:true,delay:0});
      // Prompt hooks must not restart budget between retry attempts.
      await h.hooks.prompt({sessionID:h.child.id,prompt:{text:"TEST DATA unchanged"}});
    }
    expect(seen).toEqual(Array.from({length:5},()=>["a","b","c"]).flat());
    expect(h.changes).toHaveLength(14);
    clock += 60001;
    expect((await failCurrent(h, 99)).decision).toEqual({retry:false});
    expect(h.changes).toHaveLength(14);
    // Other child gets its own full initial pass despite exhausted first child.
    h.child.id = "ses_independent";
    h.child.model = {providerID:"mock",id:"a",variant:"high"};
    expect((await failCurrent(h, 2)).decision).toEqual({retry:true,delay:0});
    expect(h.child.model.id).toBe("b");
  } finally { Date.now = now; }
});

test("v2 all models on cooldown stops immediately instead of waiting or cycling", async () => {
  const h = await harness(true, {...config,maxCycles:5} as any);
  await failCurrent(h,2);
  await failCurrent(h,3);
  expect((await failCurrent(h,4)).decision).toEqual({retry:false});
  expect(h.changes).toHaveLength(2);
});

test("v2 wrap skips unavailable catalog models and exact variants", async () => {
  const h = await harness(true, {...config,maxCycles:5} as any);
  h.child.model = {providerID:"mock",id:"c",variant:"medium"};
  h.ctx.model.list = async () => ({data:[{providerID:"mock",id:"a",variants:[{id:"wrong"}]},
    {providerID:"mock",id:"b",variants:[{id:"low"}]}]});
  expect((await failCurrent(h,2)).decision).toEqual({retry:true,delay:0});
  expect(h.child.model).toEqual({providerID:"mock",id:"b",variant:"low"});
});

test("v2 no available catalog target stops even with remaining passes", async () => {
  const h = await harness(true, {...config,maxCycles:5} as any);
  h.ctx.model.list = async () => ({data:[]});
  expect((await failCurrent(h,2)).decision).toEqual({retry:false});
  expect(h.changes).toEqual([]);
});

test("v2 preemptive all-cooldown exhaustion stays stopped after cooldown expiry", async () => {
  const h = await harness(true, {...config,maxCycles:5} as any);
  await failCurrent(h,2); await failCurrent(h,3); await failCurrent(h,4);
  h.child.id = "ses_preemptive_exhaustion";
  h.child.model = {providerID:"mock",id:"a",variant:"high"};
  await h.hooks.prompt({sessionID:h.child.id,prompt:{text:"TEST DATA"}});
  const now = Date.now; Date.now = () => now() + 60001;
  try {
    expect((await failCurrent(h,2)).decision).toEqual({retry:false});
    expect(h.changes).toHaveLength(2);
  } finally { Date.now = now; }
});
