const { Client } = require("pg");

async function one(i) {
  const c = new Client({
    connectionString: "postgresql://postgres@127.0.0.1:5432/postgres",
  });
  await c.connect();
  await c.query("SELECT $1::int AS n, version() AS v", [i]);
  await c.end();
}

(async () => {
  const ready = await one(0).then(() => true).catch((e) => {
    console.error("not ready:", e.message);
    process.exit(1);
  });
  void ready;

  let fails = 0;
  for (let i = 1; i <= 50; i++) {
    try {
      await one(i);
    } catch (e) {
      fails++;
      console.error("fail", i, e.message);
    }
  }
  console.log("burst1 fails=", fails);

  const hold = new Client({
    connectionString: "postgresql://postgres@127.0.0.1:5432/postgres",
  });
  await hold.connect();
  const v = await hold.query("SHOW server_version");
  console.log("version=", v.rows[0].server_version);
  console.log("holding 60s...");
  for (let s = 0; s < 12; s++) {
    await new Promise((r) => setTimeout(r, 5000));
    await hold.query("SELECT 1");
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  await hold.end();

  fails = 0;
  for (let i = 1; i <= 30; i++) {
    try {
      await one(100 + i);
    } catch (e) {
      fails++;
      console.error("fail2", i, e.message);
    }
  }
  console.log("burst2 fails=", fails);
  console.log("STABLE_OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
