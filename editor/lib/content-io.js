"use strict";
const BEGIN = "/* CONTENT:BEGIN */";
const END = "/* CONTENT:END */";
const DECL_RE = /^\s*(const CONTENT|window\.SHARED_CONTENT)\s*=\s*([\s\S]*?);\s*$/;

function locate(source) {
  const b = source.indexOf(BEGIN);
  const e = source.indexOf(END);
  if (b === -1 || e === -1 || e < b) throw new Error("CONTENT markers missing or out of order");
  if (source.indexOf(BEGIN, b + BEGIN.length) !== -1) throw new Error("Duplicate CONTENT:BEGIN marker");
  if (source.indexOf(END, e + END.length) !== -1) throw new Error("Duplicate CONTENT:END marker");
  return { b: b + BEGIN.length, e };
}

function extractContent(source) {
  const { b, e } = locate(source);
  const m = DECL_RE.exec(source.slice(b, e));
  if (!m) throw new Error("CONTENT block must be `const CONTENT = {...};` or `window.SHARED_CONTENT = {...};`");
  return { decl: m[1], data: JSON.parse(m[2]) };
}

function replaceContent(source, data) {
  const { decl } = extractContent(source); // also validates markers
  const { b, e } = locate(source);
  return source.slice(0, b) + "\n" + decl + " = " + JSON.stringify(data, null, 2) + ";\n" + source.slice(e);
}

module.exports = { extractContent, replaceContent, BEGIN, END };
