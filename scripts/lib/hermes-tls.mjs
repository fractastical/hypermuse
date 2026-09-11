// A certificate, so phones can share their location at all.
//
// This is not about secrecy. Browsers refuse `navigator.geolocation` outside a
// "secure context", and a LAN address over plain http is not one: Chrome and
// Safari both fail it with "Only secure origins are allowed" before the user is
// even asked to allow anything. Localhost is exempt, which is why the moon on
// this Mac is fine on http and a phone across the camp wifi is not. There is no
// internet out here to get a real certificate with, so the server signs its own
// and each phone waves the warning through once.
//
// The address has to be in subjectAltName as an IP entry. A certificate for a
// hostname does nothing for https://192.168.1.75, and neither does putting the
// address in the common name, which browsers stopped honouring years ago — so
// the certificate is regenerated whenever the camp's addresses change.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

// Every address a phone might reach this machine on. Skips loopback (which never
// needed a certificate) and link-local, which nothing types in.
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (net.address.startsWith("169.254.")) continue;
      out.push(net.address);
    }
  }
  return out;
}

// A day short of a year. iOS rejects certificates with lifetimes over 825 days
// outright, and treats long-lived self-signed ones with more suspicion, so there
// is nothing to gain by asking for ten.
const DAYS = 364;

export function ensureCert(dir, addresses = lanAddresses()) {
  const keyPath = join(dir, "hermes-key.pem");
  const certPath = join(dir, "hermes-cert.pem");
  const stampPath = join(dir, "hermes-cert.hosts");
  const want = ["127.0.0.1", ...addresses].join(",");

  // Regenerated when the addresses change, because a certificate that does not
  // name the address being typed is worse than none: the warning it produces
  // cannot be waved through on iOS.
  const stamped = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : "";
  if (existsSync(keyPath) && existsSync(certPath) && stamped === want) {
    return { key: readFileSync(keyPath), cert: readFileSync(certPath), addresses, fresh: false };
  }

  mkdirSync(dir, { recursive: true });
  const sans = [
    "DNS:localhost",
    ...["127.0.0.1", ...addresses].map((ip) => `IP:${ip}`)
  ].join(",");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath,
    "-days", String(DAYS), "-subj", "/CN=Hermes on the playa",
    "-addext", `subjectAltName=${sans}`,
    "-addext", "basicConstraints=critical,CA:FALSE",
    "-addext", "keyUsage=critical,digitalSignature,keyEncipherment",
    "-addext", "extendedKeyUsage=serverAuth"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  writeFileSync(stampPath, want);
  return { key: readFileSync(keyPath), cert: readFileSync(certPath), addresses, fresh: true };
}
