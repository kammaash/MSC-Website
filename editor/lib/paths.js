(function (exports) {
  "use strict";
  function parts(path) {
    if (typeof path !== "string" || path === "") throw new Error("Bad path: " + path);
    return path.split(".");
  }
  function getPath(obj, path) {
    let cur = obj;
    for (const p of parts(path)) {
      if (cur === null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
      cur = cur[p];
    }
    return cur;
  }
  function setPath(obj, path, value) {
    const ps = parts(path);
    const last = ps.pop();
    const parent = ps.length ? getPath(obj, ps.join(".")) : obj;
    if (parent === undefined || parent === null || typeof parent !== "object" || !Object.prototype.hasOwnProperty.call(parent, last))
      throw new Error("Path not found: " + path);
    parent[last] = value;
  }
  function getList(obj, path) {
    const list = getPath(obj, path);
    if (!Array.isArray(list)) throw new Error("Not a list: " + path);
    return list;
  }
  function addItem(obj, path, item) { getList(obj, path).push(item); }
  function removeItem(obj, path, index) {
    const list = getList(obj, path);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error("Bad index: " + index);
    list.splice(index, 1);
  }
  function moveItem(obj, path, from, to) {
    const list = getList(obj, path);
    for (const i of [from, to])
      if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error("Bad index: " + i);
    list.splice(to, 0, list.splice(from, 1)[0]);
  }
  Object.assign(exports, { getPath, setPath, addItem, removeItem, moveItem });
})(typeof module !== "undefined" ? module.exports : (window.EditorPaths = {}));
