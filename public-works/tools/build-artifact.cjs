#!/usr/bin/env node
// Make a copy of index.html suitable for publishing as a claude.ai Artifact:
// strips the document skeleton (the host adds its own) and sets PW_EMBED so the
// CSV button copies to the clipboard instead of downloading.
//   node tools/build-artifact.cjs <out.html>
const fs = require("fs"), path = require("path");
const out = process.argv[2];
if (!out) { console.error("usage: build-artifact.cjs <out.html>"); process.exit(2); }
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/i, "").replace(/<meta name="viewport"[^>]*>\s*/i, "");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace('<script src="data/projects.js"></script>', '<script>window.PW_EMBED = true;</script>\n  <script src="data/projects.js"></script>');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, head.trim() + "\n" + body.trim() + "\n");
console.log("wrote", out);
