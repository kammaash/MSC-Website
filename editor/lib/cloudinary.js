"use strict";
const crypto = require("node:crypto");
function signParams(params, apiSecret) {
  const toSign = Object.keys(params).sort().map((k) => k + "=" + params[k]).join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}
module.exports = { signParams };
