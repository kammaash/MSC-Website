"use strict";
const { getPath, setPath, addItem, removeItem, moveItem } = require("./paths.js");

function validateText(value) {
  if (typeof value !== "string") throw new Error("Text value must be a string");
  if (/<\s*\/?\s*script/i.test(value)) throw new Error("Text may not contain script tags");
  if (/CONTENT:BEGIN|CONTENT:END/i.test(value)) throw new Error("Text may not contain CONTENT:BEGIN or CONTENT:END markers");
}

function validateItem(item, template) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error("Item must be an object");
  const want = Object.keys(template).sort().join(",");
  const got = Object.keys(item).sort().join(",");
  if (want !== got) throw new Error("Item keys must be exactly: " + want);
  for (const v of Object.values(item)) validateText(v);
  if ("kind" in template && !["image", "video"].includes(item.kind)) throw new Error("kind must be image or video");
}

function requireCollection(templates, path) {
  const t = templates[path];
  if (!t) throw new Error("Unknown collection: " + path);
  return t;
}

function applyPatch(data, patch, templates) {
  for (const op of (patch && patch.ops) || []) {
    if (op.type === "set") {
      validateText(op.value);
      if (typeof getPath(data, op.path) !== "string") throw new Error("Unknown or non-text path: " + op.path);
      setPath(data, op.path, op.value);
    } else if (op.type === "add") {
      validateItem(op.item, requireCollection(templates, op.path));
      addItem(data, op.path, op.item);
    } else if (op.type === "remove") {
      requireCollection(templates, op.path);
      removeItem(data, op.path, op.index);
    } else if (op.type === "move") {
      requireCollection(templates, op.path);
      moveItem(data, op.path, op.from, op.to);
    } else {
      throw new Error("Unknown op type: " + (op && op.type));
    }
  }
  return data;
}

module.exports = { applyPatch, validateText, validateItem };
