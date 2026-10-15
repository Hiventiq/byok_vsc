"use strict";
// Pure escaping helpers for the webview and the Markdown hover.

const HTML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML[c]);
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, "\\$&");
}

module.exports = { escapeHtml, escapeMarkdown };
