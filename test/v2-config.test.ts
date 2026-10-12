import { expect, test } from "bun:test";
import * as loader from "../src/config/agent-loader";

test("v2 parser rejects malformed references, primary agents and unsafe body overrides", () => {
  const parse = (loader as any).parseV2Agent;
  for (const model of ["no-provider", "p/#high", "p/m#", "p/m#high#max", " p/m", "p/m\n"]) {
    expect(() => parse(`---\nmode: subagent\nmodel: ${JSON.stringify(model)}\n---\n`)).toThrow();
  }
  for (const request of ["[]", "{body: []}", "{body: {model: other}}", "{body: {__proto__: {x: true}}}"]) {
    expect(() => parse(`---\nmode: subagent\nmodel: p/m\nrequest: ${request}\n---\n`)).toThrow();
  }
  expect(() => parse("---\nmode: primary\nmodel: p/m\n---\n")).toThrow();
  expect(() => parse("---\nmode: subagent\nmodel: !!js/function x\n---\n")).toThrow();
});

test("v2 chain parser preserves model variants and optional request.body per step", () => {
  expect(typeof (loader as any).parseV2Agent).toBe("function");
  const parse = (loader as any).parseV2Agent;
  expect(parse("---\nmode: subagent\nmodel: kimi-code-plan-cn/kimi-for-coding#high\nrequest:\n  body:\n    thinking:\n      type: disabled\n---\nKEEP PROMPT")).toEqual({ model: "kimi-code-plan-cn/kimi-for-coding#high", request: { body: { thinking: { type: "disabled" } } } });
});
