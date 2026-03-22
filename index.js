const { getStatus, runOnce } = require("./lib/automation");

async function main() {
  const command = process.argv[2] || "status";
  const args = new Set(process.argv.slice(3));

  if (command === "status") {
    const result = await getStatus();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "preview") {
    const result = await runOnce({
      force: true,
      dryRun: true
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "run") {
    const result = await runOnce({
      force: args.has("--force"),
      dryRun: args.has("--dry-run")
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "--help" || command === "help") {
    console.log("Commands: status | preview | run [--force] [--dry-run]");
    return;
  }

  if (args.has("--check-only")) {
    console.log("{\"ok\":true}");
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
