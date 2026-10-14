"use strict";
// Pure: read the claims of a JWT without verifying it (we only display what the CLI already trusts).

function decodeJwtPayload(token) {
  if (typeof token !== "string" || token.split(".").length < 3) return null;
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

module.exports = { decodeJwtPayload };
