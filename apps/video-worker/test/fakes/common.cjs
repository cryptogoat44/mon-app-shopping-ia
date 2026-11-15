// Outils communs aux faux programmes des tests (aucun accès au réseau).
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** Note les arguments reçus dans FAKE_RECORD_DIR (si le test l'a donné). */
function record(tool, args, extra = {}) {
  const dir = process.env.FAKE_RECORD_DIR;
  if (!dir) return;
  const file = path.join(dir, `${tool}-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`);
  fs.writeFileSync(file, JSON.stringify({ tool, pid: process.pid, args, ...extra }));
}

/** Nombre d'appels déjà notés pour ce programme et ce scénario. */
function previousCalls(tool, scenario) {
  const dir = process.env.FAKE_RECORD_DIR;
  if (!dir) return 0;
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${tool}-`))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
    .filter((entry) => entry.scenario === scenario).length;
}

/** Attend sans fin (le service doit tuer le programme). */
function hang(ms) {
  setTimeout(() => process.exit(0), ms);
}

module.exports = { record, previousCalls, hang };
