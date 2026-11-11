import net from "node:net";
import { EgressDenied } from "./errors.ts";

// RED-phase signature stubs: the behavior lands in the GREEN commit.
export const DENY_LIST = new net.BlockList();

export function ipDenied(_ip: string): boolean {
  return false;
}

export function nameDenied(_host: string): boolean {
  return false;
}

export function checkUrl(_url: URL, _allow: ReadonlySet<string>): void {
  void EgressDenied;
}
