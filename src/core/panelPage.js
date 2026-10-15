"use strict";
// Pure: the full HTML document of the webview panel (CSP, theme-aware styles, click wiring).

const STYLE = `
body{font:12px var(--vscode-font-family);color:var(--vscode-foreground);padding:6px 10px}
h3{margin:12px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.7}
.card{border-left:3px solid;border-radius:6px;background:var(--vscode-sideBar-background,transparent);
  box-shadow:inset 0 0 0 1px var(--vscode-widget-border,#8883);padding:8px 10px;margin-bottom:8px}
.card.active{background:var(--vscode-list-hoverBackground)}
.head{display:flex;align-items:center;gap:8px;margin-bottom:6px}.sub{opacity:.65;font-size:11px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btns button{background:none;border:0;color:var(--vscode-foreground);opacity:.55;cursor:pointer;padding:2px 4px;font-size:11px}
.btns button:hover{opacity:1}
.top{display:flex;justify-content:space-between;margin-top:6px}
.track{height:8px;border-radius:4px;background:#8883;overflow:hidden;margin:3px 0 2px}
.track i{display:block;height:100%;border-radius:4px;min-width:6px}
.foot{opacity:.6;font-size:11px;min-height:13px}`;

const SCRIPT = `const vs=acquireVsCodeApi();
document.addEventListener("click",e=>{const b=e.target.closest("button[data-cmd]");
if(b)vs.postMessage({cmd:b.dataset.cmd,provider:b.dataset.provider,id:b.dataset.id});});`;

function panelPage(body, nonce) {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>${STYLE}</style></head><body>${body}<script nonce="${nonce}">${SCRIPT}</script></body></html>`;
}

module.exports = { panelPage };
