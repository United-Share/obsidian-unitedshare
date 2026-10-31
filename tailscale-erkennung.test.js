"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { tailscaleAdresseAusText, erkenneTailscaleAdresse } = require("./unitedshare-core");

// -- tailscaleAdresseAusText (reine Parse-Funktion) --------------------------

test("eine saubere Zeile wird erkannt", () => {
  assert.equal(tailscaleAdresseAusText("100.64.0.6\n"), "100.64.0.6");
});

test("mehrere Zeilen: die erste gueltige 100.x.x.x-Zeile zaehlt", () => {
  const text = "100.64.0.6\n100.64.0.7\n";
  assert.equal(tailscaleAdresseAusText(text), "100.64.0.6");
});

test("eine IPv6-Zeile vor der gueltigen IPv4-Zeile wird uebersprungen", () => {
  const text = "fd7a:115c:a1e0::6\n100.64.0.6\n";
  assert.equal(tailscaleAdresseAusText(text), "100.64.0.6");
});

test("leerer String ist nicht erkannt", () => {
  assert.equal(tailscaleAdresseAusText(""), null);
  assert.equal(tailscaleAdresseAusText(undefined), null);
  assert.equal(tailscaleAdresseAusText(null), null);
});

test("ein Fehlertext statt einer Adresse ist nicht erkannt", () => {
  assert.equal(tailscaleAdresseAusText("failed to connect to local tailscaled\n"), null);
});

test("nur eine IPv6-Zeile ohne gueltige IPv4-Zeile ist nicht erkannt", () => {
  assert.equal(tailscaleAdresseAusText("fd7a:115c:a1e0::6\n"), null);
});

test("fuehrende und folgende Leerzeichen werden getrimmt", () => {
  assert.equal(tailscaleAdresseAusText("  100.64.0.6  \n"), "100.64.0.6");
  assert.equal(tailscaleAdresseAusText("\n\n  100.64.0.6\n\n"), "100.64.0.6");
});

// -- erkenneTailscaleAdresse (injizierbare Erkennung) ------------------------

function spawnOk(stdout, code) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.emit("data", stdout);
      child.emit("close", code == null ? 0 : code);
    });
    return child;
  };
}

test("eine gueltige Tailscale-Ausgabe liefert die Adresse", async () => {
  const adresse = await erkenneTailscaleAdresse({ spawnImpl: spawnOk("100.64.0.6\n") });
  assert.equal(adresse, "100.64.0.6");
});

test("ein Startfehler (Befehl nicht gefunden) liefert null, wirft nicht", async () => {
  const spawnImpl = () => {
    throw new Error("command not found");
  };
  const adresse = await erkenneTailscaleAdresse({ spawnImpl });
  assert.equal(adresse, null);
});

test("ein error-Ereignis des Kindprozesses liefert null", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => child.emit("error", new Error("spawn")));
    return child;
  };
  const adresse = await erkenneTailscaleAdresse({ spawnImpl });
  assert.equal(adresse, null);
});

test("Fehlertext auf stderr liefert null, nicht eine kaputte Adresse", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      child.stderr.emit("data", "failed to connect to local tailscaled\n");
      child.emit("close", 1);
    });
    return child;
  };
  const adresse = await erkenneTailscaleAdresse({ spawnImpl });
  assert.equal(adresse, null);
});

test("ein haengender Aufruf bricht nach der Frist ab und liefert null", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("close", null);
    return child;
  };
  const adresse = await erkenneTailscaleAdresse({ spawnImpl, timeoutMs: 30 });
  assert.equal(adresse, null);
});

test("ein Kindprozess ohne stdout/stderr liefert null, wirft nicht", async () => {
  const spawnImpl = () => ({ kill: () => {} });
  const adresse = await erkenneTailscaleAdresse({ spawnImpl });
  assert.equal(adresse, null);
});
