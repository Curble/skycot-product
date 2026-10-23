import { getRandomValues } from "expo-crypto";

// SKYCOT Relay's sealing (the audited @noble libraries) asks for the system's secure random
// numbers through the web's standard name; React Native's engine doesn't provide it itself.
const webCrypto = (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto;
if (webCrypto === undefined) {
  (globalThis as { crypto?: unknown }).crypto = { getRandomValues };
} else if (typeof webCrypto.getRandomValues !== "function") {
  webCrypto.getRandomValues = getRandomValues;
}
