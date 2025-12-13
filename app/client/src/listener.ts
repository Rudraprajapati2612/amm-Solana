// working-listener.ts - Real-time listener using onLogs (ACTUALLY WORKS!)
import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID!);
const wsEndpointRpc = process.env.SOLANA_WS_URL;
if(!wsEndpointRpc){
  throw new Error("Websocker RPC is missing");
}
const connection = new Connection(process.env.SOLANA_RPC_URL!, {
  commitment: "confirmed",
  wsEndpoint: wsEndpointRpc, // Explicit WebSocket
});

console.log("👂 Listening for AMM logs...");
console.log("Program ID:", PROGRAM_ID.toBase58());
console.log("✅ Listener active. Run transactions now!\n");

// Subscribe to program logs
const subscriptionId = connection.onLogs(
  PROGRAM_ID,
  (logs, ctx) => {
    console.log("\n" + "=".repeat(80));
    console.log("🔔 NEW TRANSACTION DETECTED!");
    console.log("Signature:", logs.signature);
    console.log("Slot:", ctx.slot);
    console.log("=".repeat(80));

    if (logs.err) {
      console.log("❌ Transaction Failed:", logs.err);
    } else {
      console.log("✅ Transaction Successful");
    }

    // Parse logs
    console.log("\n📜 LOGS:\n");
    logs.logs.forEach((log, i) => {
      // Highlight important logs with colors
      if (log.includes("Initializing AMM Pool")) {
        console.log(`\x1b[32m${i + 1}. 🔥 ${log}\x1b[0m`);
      } else if (log.includes("AddLiquidity") || log.includes("Liquidity")) {
        console.log(`\x1b[36m${i + 1}. 💧 ${log}\x1b[0m`);
      } else if (log.includes("Swap")) {
        console.log(`\x1b[33m${i + 1}. 🔄 ${log}\x1b[0m`);
      } else if (log.includes("error") || log.includes("Error")) {
        console.log(`\x1b[31m${i + 1}. ❌ ${log}\x1b[0m`);
      } else {
        console.log(`${i + 1}. ${log}`);
      }
    });

    console.log("\n🔗 Explorer:", `https://explorer.solana.com/tx/${logs.signature}?cluster=devnet`);
    console.log("=".repeat(80) + "\n");
  },
  "confirmed"
);

console.log("Subscription ID:", subscriptionId);
console.log("\n⏳ Waiting for transactions... (Press Ctrl+C to stop)\n");

// Keep process alive
process.on("SIGINT", () => {
  console.log("\n\n🛑 Removing subscription...");
  connection.removeOnLogsListener(subscriptionId);
  console.log("✅ Cleanup complete");
  process.exit(0);
});