import type { Plugin } from "@opencode/plugin";
import { Model } from "@opencode/plugin";
import { readFileSync } from "node:fs";
import { validateV2Step, type V2Step } from "./config/agent-loader.js";
import { classifyError } from "./detection/classifier.js";

export interface V2Config {
  version: 2;
  cooldownMs: number;
  maxCycles?: number;
  agents: Record<string, { chain: V2Step[] }>;
}

function parseConfig(raw: unknown): V2Config {
  const value = raw as V2Config;
  if (!value || value.version !== 2 || !Number.isFinite(value.cooldownMs) || value.cooldownMs < 10000 ||
      !value.agents || typeof value.agents !== "object" || Array.isArray(value.agents)) {
    throw new Error("Invalid v2 fallback config");
  }
  const maxCycles = value.maxCycles === undefined ? 1 : value.maxCycles;
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 5) {
    throw new Error("maxCycles must be an integer from 1 to 5");
  }
  const agents: V2Config["agents"] = {};
  for (const [agent, entry] of Object.entries(value.agents)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(agent) || !Array.isArray(entry?.chain) || entry.chain.length < 2 || entry.chain.length > 10) {
      throw new Error("Only explicit agent chains with 2–10 steps are allowed");
    }
    agents[agent] = { chain: entry.chain.map(validateV2Step) };
  }
  return {version: 2, cooldownMs: value.cooldownMs, maxCycles: value.maxCycles ?? 1, agents};
}

const key = (model: {providerID: string; id: string}) => `${model.providerID}/${model.id}`;
const exact = (model: {providerID: string; id: string; variant?: string}) => key(model) + `#${model.variant ?? "default"}`;
const matches = (model: {providerID: string; id: string; variant?: string}, reference: string) => exact(model) === exact(Model.Ref.parse(reference));

export default {
  id: "smart-coders.model-fallback.v2-local",
  async setup(ctx) {
    const config = parseConfig(ctx.options.config ?? JSON.parse(readFileSync(
      typeof ctx.options.configPath === "string" ? ctx.options.configPath : new URL("../deployment/model-fallback.v2.json", import.meta.url), "utf8")));
    // Agent source transforms may activate AFTER plugin setup. Verify the effective
    // agent at request time, never infer scope from the configured name alone.
    const isSubagent = async (id: string) => (await ctx.agent.list()).data.some(a => a.id === id && a.mode === "subagent");
    const unavailableUntil = new Map<string, number>();
    const registrations: Array<{dispose: () => Promise<void>}> = [];
    // A child session owns one budget for this plugin lifetime; retries and prompt
    // hooks never replenish it. A new child starts at pass 1, even mid-chain.
    const progress = new Map<string, {index: number; pass: number; stopped: boolean; lastAttempt?: number}>();
    const stateFor = (sessionID: string, index: number) => {
      let state = progress.get(sessionID);
      if (!state) { state = {index, pass: 1, stopped: false}; progress.set(sessionID, state); }
      return state;
    };
    const next = async (chain: V2Step[], state: {index: number; pass: number}) => {
      const { data: models } = await ctx.model.list();
      // Scan at most the rest of this pass and one wrap. If nothing is ready,
      // stop now rather than spending passes polling or waiting for cooldowns.
      const end = state.pass < config.maxCycles! ? chain.length + state.index : chain.length - 1;
      for (let cursor = state.index + 1; cursor <= end; cursor++) {
        const index = cursor % chain.length;
        const step = chain[index];
        const ref = Model.Ref.parse(step.model);
        if ((unavailableUntil.get(key(ref)) ?? 0) <= Date.now() && models.some(m =>
          m.providerID === ref.providerID && m.id === ref.id && (!ref.variant || m.variants.some(v => v.id === ref.variant)))) {
          return {step, index, pass: state.pass + (cursor >= chain.length ? 1 : 0)};
        }
      }
    };
    registrations.push(await ctx.session.hook("prompt", async event => {
      const session = await ctx.session.get({sessionID: event.sessionID});
      const chain = session.agent ? config.agents[session.agent]?.chain : undefined;
      if (!session.parentID || !chain || !session.model || (unavailableUntil.get(key(session.model)) ?? 0) <= Date.now()) return;
      const index = chain.findIndex(step => matches(session.model!, step.model));
      if (index < 0 || !session.agent || !await isSubagent(session.agent)) return;
      const state = stateFor(event.sessionID, index);
      if (state.stopped || state.index !== index) return;
      const target = await next(chain, state);
      if (target) {
        await ctx.session.switchModel({sessionID: event.sessionID, model: Model.Ref.parse(target.step.model)});
        Object.assign(state, {index: target.index, pass: target.pass});
      } else { state.stopped = true; }
    }));
    registrations.push(await ctx.session.hook("retry", async event => {
      const chain = config.agents[event.agent]?.chain;
      if (!chain) return;
      const session = await ctx.session.get({sessionID: event.sessionID});
      if (!session.parentID || session.agent !== event.agent || !await isSubagent(event.agent)) return;
      if (!session.model || exact(session.model) !== exact(event.model)) return;
      const category = classifyError(event.error.message, event.error.status);
      if (!["rate_limit", "quota_exceeded", "5xx", "timeout", "overloaded"].includes(category)) return;
      const index = chain.findIndex(step => matches(event.model, step.model));
      if (index < 0) return;
      const state = stateFor(event.sessionID, index);
      if (state.index !== index || (state.lastAttempt !== undefined && event.attempt <= state.lastAttempt)) return;
      if (state.stopped) { event.decision = {retry: false}; return; }
      state.lastAttempt = event.attempt;
      unavailableUntil.set(key(event.model), Date.now() + config.cooldownMs);
      const target = await next(chain, state);
      if (!target) { state.stopped = true; event.decision = {retry: false}; return; }
      await ctx.session.switchModel({sessionID: event.sessionID, model: Model.Ref.parse(target.step.model)});
      Object.assign(state, {index: target.index, pass: target.pass});
      // v2's retry loop refreshes context in the SAME running child/job. No abort, revert,
      // prompt replay, agent switch or parent mutation: the native job owns completion.
      event.decision = {retry: true, delay: 0};
    }));
    // Native attempt numbers restart for the next logical step. A successful
    // primary response clears only this stale-event fence, never the pass budget.
    registrations.push(await ctx.session.hook("http.response", async event => {
      if (event.kind !== "primary" || !event.response.ok) return;
      const state = progress.get(event.sessionID);
      if (!state) return;
      const session = await ctx.session.get({sessionID: event.sessionID});
      if (session.parentID && session.agent === event.agent && session.model &&
          exact(session.model) === exact(event.model) && await isSubagent(event.agent)) {
        state.lastAttempt = undefined;
      }
    }));
    registrations.push(await ctx.session.hook("http.request", async event => {
      if (event.kind !== "primary") return;
      const chain = config.agents[event.agent]?.chain;
      const body = chain?.find(step => matches(event.model, step.model))?.request?.body;
      if (!body) return;
      const session = await ctx.session.get({sessionID: event.sessionID});
      if (!session.parentID || session.agent !== event.agent || !await isSubagent(event.agent)) return;
      const merge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
        const result = { ...base };
        for (const [key, value] of Object.entries(override)) {
          result[key] = value && typeof value === "object" && !Array.isArray(value) &&
            result[key] && typeof result[key] === "object" && !Array.isArray(result[key])
            ? merge(result[key] as Record<string, unknown>, value as Record<string, unknown>) : structuredClone(value);
        }
        return result;
      };
      const data = await event.request.clone().json() as Record<string, unknown>;
      const headers = new Headers(event.request.headers);
      headers.delete("content-length");
      event.request = new Request(event.request, {headers, body: JSON.stringify(merge(data, body))});
    }));
    return async () => { for (const registration of registrations) await registration.dispose(); };
  }
} satisfies Plugin.Plugin;
