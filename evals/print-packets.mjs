import { cases, packetHash } from "./lib.mjs";

console.log(JSON.stringify(cases.map((item) => ({
  caseId: item.id,
  title: item.title,
  packetHash: packetHash(item),
})), null, 2));
